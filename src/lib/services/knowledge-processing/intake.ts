import "server-only";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createUploadIntentToken, verifyUploadIntentToken } from "./upload-intent-token";
import { INTERNAL_SERVICE_SECRET_HEADER } from "./internal-auth";

// Knowledge Processing Service — document-intake policy (Phase 4,
// Increment 1 revision). These values govern Version 1 document-intake
// eligibility and are owned exclusively by this service. Route Handlers
// perform only request-shape boundary validation and never evaluate policy
// themselves (CSA ruling: Upload Intent Responsibility Boundary
// Reconciliation).
export const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_CONTENT_TYPE = "application/pdf";
const DOCUMENTS_BUCKET = "documents";

export interface UploadIntentRequest {
  filename: string;
  contentType: string;
  declaredSize: number;
}

export type AuthorizeIntakeResult =
  | {
      accepted: true;
      storagePath: string;
      supabaseUpload: { signedUrl: string; token: string; path: string };
      uploadIntentToken: string;
    }
  | {
      accepted: false;
      reason: "unsupported_content_type" | "size_exceeds_policy" | "invalid_filename";
    };

// Evaluates Version 1 document-intake policy and, on acceptance, establishes
// the controlled upload target: a server-generated Storage path, a
// narrowly-scoped Supabase signed upload authorization, and a tamper-evident
// upload-intent continuity token binding the accepted claims. No Document
// row is created here — per the approved Document-creation-timing ruling, a
// Document exists only once completion is independently verified
// (confirmDocumentIntake below). The declared size is a policy pre-check
// only; it is never trusted as proof of the eventual physical object's
// actual size.
export async function authorizeDocumentIntake({
  filename,
  contentType,
  declaredSize,
}: UploadIntentRequest): Promise<AuthorizeIntakeResult> {
  if (contentType !== ACCEPTED_CONTENT_TYPE) {
    return { accepted: false, reason: "unsupported_content_type" };
  }

  const trimmedFilename = filename.trim();

  if (trimmedFilename.length === 0 || !trimmedFilename.toLowerCase().endsWith(".pdf")) {
    return { accepted: false, reason: "invalid_filename" };
  }

  if (declaredSize > MAX_DOCUMENT_SIZE_BYTES) {
    return { accepted: false, reason: "size_exceeds_policy" };
  }

  const supabase = createServiceClient();
  const storagePath = `${crypto.randomUUID()}.pdf`;

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    throw new Error(
      `Failed to obtain a controlled Storage upload authorization: ${error?.message}`
    );
  }

  const uploadIntentToken = createUploadIntentToken({
    storagePath,
    filename: trimmedFilename,
    contentType,
    declaredSize,
  });

  return {
    accepted: true,
    storagePath,
    supabaseUpload: { signedUrl: data.signedUrl, token: data.token, path: data.path },
    uploadIntentToken,
  };
}

export interface DocumentIntakeResult {
  id: string;
  filename: string;
  status: string;
  storageReference: string;
}

export type ConfirmIntakeResult =
  | { accepted: true; document: DocumentIntakeResult }
  | {
      accepted: false;
      reason:
        | "invalid_token"
        | "expired_token"
        | "object_not_found"
        | "size_exceeds_policy"
        | "content_type_mismatch";
    };

// Independently verifies upload-intent continuity and the physical Storage
// object before ever creating a Document. Object existence alone is never
// sufficient — every check here re-derives facts from the server-signed
// token and from Supabase Storage itself, never from the caller's
// assertions (authorization-time acceptance does not eliminate
// completion-time verification). A rejected-but-completed object is deleted
// as responsibility-integrity cleanup for this service's own two-step
// operation, not as general orphan management.
export async function confirmDocumentIntake(
  uploadIntentToken: string
): Promise<ConfirmIntakeResult> {
  const verification = verifyUploadIntentToken(uploadIntentToken);

  if (!verification.valid) {
    return {
      accepted: false,
      reason: verification.reason === "expired" ? "expired_token" : "invalid_token",
    };
  }

  const { storagePath, filename } = verification.claims;
  const supabase = createServiceClient();

  const { data: objectInfo, error: infoError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .info(storagePath);

  if (infoError || !objectInfo) {
    return { accepted: false, reason: "object_not_found" };
  }

  if (typeof objectInfo.size !== "number" || objectInfo.size > MAX_DOCUMENT_SIZE_BYTES) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    return { accepted: false, reason: "size_exceeds_policy" };
  }

  if (objectInfo.contentType !== ACCEPTED_CONTENT_TYPE) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    return { accepted: false, reason: "content_type_mismatch" };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("documents")
    .insert({
      filename,
      status: "uploaded",
      storage_reference: storagePath,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: existing, error: lookupError } = await supabase
        .from("documents")
        .select()
        .eq("storage_reference", storagePath)
        .single();

      if (lookupError || !existing) {
        throw new Error(
          `Uniqueness conflict on storage_reference but the existing document could not be found: ${lookupError?.message}`
        );
      }

      return {
        accepted: true,
        document: {
          id: existing.id,
          filename: existing.filename,
          status: existing.status,
          storageReference: existing.storage_reference ?? storagePath,
        },
      };
    }

    throw new Error(`Failed to create document record: ${insertError.message}`);
  }

  // Approved trigger architecture (Phase 4, Increment 3): confirmDocumentIntake
  // -> after() -> internal authenticated processing Route Handler ->
  // Knowledge Processing Service. Triggered only on a genuine first-time
  // Document creation, never on the 23505 duplicate/race-return path above
  // -- that path returns a Document that may already be processing or
  // further along, and must never be reprocessed from here (processDocument
  // also independently guards this by status).
  triggerAsynchronousProcessing(inserted.id);

  return {
    accepted: true,
    document: {
      id: inserted.id,
      filename: inserted.filename,
      status: inserted.status,
      storageReference: inserted.storage_reference ?? storagePath,
    },
  };
}

// Resolves this deployment's own base URL for a server-to-server call.
// VERCEL_URL is automatically injected by the platform for every
// deployment (production, preview, and internal); no new environment
// variable is introduced. Falls back to localhost for local development.
function resolveInternalBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return `http://localhost:${process.env.PORT ?? 3000}`;
}

// Invokes the internal processing Route Handler from within after(), so the
// call is not a detached/fire-and-forget fetch (it is awaited, and kept
// alive past the response via the platform's waitUntil) and does not block
// the client-facing upload-completion response (after() runs only once that
// response has been sent). The internal Route Handler runs as its own,
// independently budgeted serverless invocation -- this is a working
// implementation hypothesis pending empirical capacity validation, not a
// confirmed guarantee (see Increment 3 evidence-gathering).
function triggerAsynchronousProcessing(documentId: string): void {
  after(async () => {
    try {
      const secret = process.env.INTERNAL_SERVICE_SECRET;

      if (!secret) {
        throw new Error("Missing INTERNAL_SERVICE_SECRET server configuration.");
      }

      const response = await fetch(
        `${resolveInternalBaseUrl()}/api/v1/internal/documents/process`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [INTERNAL_SERVICE_SECRET_HEADER]: secret,
          },
          body: JSON.stringify({ documentId }),
        }
      );

      if (!response.ok) {
        throw new Error(`Internal processing trigger returned status ${response.status}.`);
      }
    } catch {
      // The trigger invocation itself failed (network error, missing
      // secret, non-2xx response). The Document remains in `uploaded`
      // status rather than being silently marked otherwise -- this is
      // visible via existing Document status retrieval (Increment 2), not
      // swallowed. No retry is implemented in this increment (see
      // Increment 3 evidence-gathering: durability gap, not addressed
      // here without further CSA direction).
    }
  });
}
