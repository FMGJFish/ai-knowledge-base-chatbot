"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

type DocumentSummary = {
  id: string;
  filename: string;
  status: string;
  uploadedAt: string;
  processingError: string | null;
};

// Mirrors processing.ts's ProcessDocumentResult exactly -- the discriminant
// this panel must inspect before treating a manual processing request as
// successful (response.ok alone only means the request was well-formed and
// authorized, not that processing itself succeeded).
type ProcessDocumentResponse =
  | { status: "ready_for_review"; documentId: string; chunkCount: number }
  | { status: "failed"; documentId: string; reason: string }
  | { status: "skipped"; documentId: string; currentStatus: string };

const DOCUMENTS_BUCKET = "documents";
const ACCEPTED_CONTENT_TYPE = "application/pdf";

// Document Management Surface panel (Phase 8, Increment 1). Presentation
// only: every operation below calls one of the already-implemented,
// already-admin-gated Documents/Knowledge Management endpoints exactly as
// they already behave -- no new API route, no new persistence, no new
// business logic. The upload flow follows the existing two-phase,
// direct-to-Supabase-Storage contract (ADR Decision 017) exactly:
// POST /api/v1/documents (authorization) -> direct browser upload to
// Storage using the returned signed URL -> POST /api/v1/documents/complete
// (finalization).
//
// `processing_error` is displayed for `failed` Documents as of the Document
// Processing Reliability and Recovery correction (Finding #2) -- the
// backend API contract (GET /api/v1/documents, GET /api/v1/documents/[id])
// now exposes this already-sanitized field via documents-query.ts.
//
// The "Process" action also now covers stale-processing recovery (Finding
// #1): it renders for both `uploaded` and `processing` Documents and calls
// the same existing endpoint in both cases. For a `processing` Document,
// the server independently determines whether the lease has actually gone
// stale (processing.ts) -- a still-legitimately-running Document returns a
// `skipped` result, surfaced to the administrator exactly as any other
// skip already is, never silently.
export function DocumentsPanel() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadInFlight = useRef(false);

  const [publishPendingId, setPublishPendingId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [processPendingId, setProcessPendingId] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setListError(null);

    try {
      const response = await fetch("/api/v1/documents");

      if (!response.ok) {
        setListError(`Failed to load documents (status ${response.status}).`);
        return;
      }

      const data = (await response.json()) as { documents: DocumentSummary[] };
      setDocuments(data.documents);
    } catch {
      setListError("Failed to load documents.");
    }
  }, []);

  // Fetch is inlined here (rather than calling loadDocuments() directly)
  // to keep this effect's own setState calls inside the .then() callback
  // with an explicit cancelled guard, matching the pattern already
  // established in widget-app.tsx -- calling a state-setting function
  // synchronously at the top of an effect body is flagged by this
  // project's react-hooks/set-state-in-effect rule.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/v1/documents").then(
      async (response) => {
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setListError(`Failed to load documents (status ${response.status}).`);
          return;
        }

        const data = (await response.json()) as { documents: DocumentSummary[] };

        if (!cancelled) {
          setDocuments(data.documents);
        }
      },
      () => {
        if (!cancelled) {
          setListError("Failed to load documents.");
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile || uploadInFlight.current) {
      return;
    }

    uploadInFlight.current = true;
    setUploadPending(true);
    setUploadError(null);

    try {
      const authorizeResponse = await fetch("/api/v1/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: selectedFile.name,
          contentType: selectedFile.type || ACCEPTED_CONTENT_TYPE,
          declaredSize: selectedFile.size,
        }),
      });

      if (!authorizeResponse.ok) {
        const body = await authorizeResponse.json().catch(() => null);
        setUploadError(
          body?.error ?? `Upload authorization failed (status ${authorizeResponse.status}).`
        );
        return;
      }

      const { supabaseUpload, uploadIntentToken } = (await authorizeResponse.json()) as {
        storagePath: string;
        supabaseUpload: { signedUrl: string; token: string; path: string };
        uploadIntentToken: string;
      };

      const supabase = createBrowserClient();
      const { error: storageError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .uploadToSignedUrl(supabaseUpload.path, supabaseUpload.token, selectedFile, {
          contentType: selectedFile.type || ACCEPTED_CONTENT_TYPE,
        });

      if (storageError) {
        setUploadError(`Upload to storage failed: ${storageError.message}`);
        return;
      }

      const completeResponse = await fetch("/api/v1/documents/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadIntentToken }),
      });

      if (!completeResponse.ok) {
        const body = await completeResponse.json().catch(() => null);
        setUploadError(
          body?.error ?? `Upload completion failed (status ${completeResponse.status}).`
        );
        return;
      }

      setSelectedFile(null);
      await loadDocuments();
    } catch {
      setUploadError("Upload failed.");
    } finally {
      uploadInFlight.current = false;
      setUploadPending(false);
    }
  }

  async function handlePublish(documentId: string) {
    if (publishPendingId) {
      return;
    }

    setPublishPendingId(documentId);
    setPublishError(null);

    try {
      const response = await fetch(`/api/v1/knowledge/${documentId}/publish`, {
        method: "POST",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setPublishError(body?.error ?? `Publish failed (status ${response.status}).`);
        return;
      }

      await loadDocuments();
    } catch {
      setPublishError("Publish failed.");
    } finally {
      setPublishPendingId(null);
    }
  }

  // Bounded administrator recovery action (Phase 8, Increment 3 correction;
  // extended to cover stale `processing` Documents by the Document
  // Processing Reliability and Recovery correction, Finding #1): invokes the
  // existing processDocument() service for a Document stuck in `uploaded`
  // (the automatic asynchronous trigger never completed) or, now, a
  // Document stranded in `processing` whose lease has gone stale (the
  // invocation itself was killed before reaching `ready_for_review` or
  // `failed`). Deliberately does not publish on success; publishing remains
  // the separate, explicit action above.
  async function handleProcess(documentId: string) {
    if (processPendingId) {
      return;
    }

    setProcessPendingId(documentId);
    setProcessError(null);

    try {
      const response = await fetch(`/api/v1/documents/${documentId}/process`, {
        method: "POST",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setProcessError(body?.error ?? `Processing failed (status ${response.status}).`);
        return;
      }

      // A 200 response only means the request was well-formed and
      // authorized -- the discriminated result body is what determines
      // whether processing actually succeeded, failed, or was skipped.
      const result = (await response.json()) as ProcessDocumentResponse;

      if (result.status === "failed") {
        setProcessError(result.reason);
      } else if (result.status === "skipped") {
        setProcessError(
          result.currentStatus === "processing"
            ? "This document is still actively processing and was not eligible for recovery yet."
            : `Processing was skipped: this document is no longer eligible (current status "${result.currentStatus}").`
        );
      }

      await loadDocuments();
    } catch {
      setProcessError("Processing failed.");
    } finally {
      setProcessPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleUpload} className="flex items-center gap-3">
        <input
          type="file"
          accept="application/pdf"
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          disabled={uploadPending}
        />
        <button
          type="submit"
          disabled={!selectedFile || uploadPending}
          className="rounded border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploadPending ? "Uploading…" : "Upload"}
        </button>
      </form>

      {/* Informational only -- not enforced here. The upload authorization
          endpoint enforces this same 10 MB ceiling (intake.ts's
          MAX_DOCUMENT_SIZE_BYTES), established by live Staging measurement
          and canonicalized by Chief Systems Architect approval (Document
          Processing Reliability and Recovery correction, Delegation
          Authority Amendment 1). */}
      <p className="text-xs text-gray-600">
        For reliable processing on this deployment, PDFs up to 10 MB are supported. Larger documents
        may take longer to process than this deployment&apos;s execution limit allows.
      </p>

      {uploadError ? (
        <p role="alert" className="text-sm text-red-700">
          {uploadError}
        </p>
      ) : null}

      {publishError ? (
        <p role="alert" className="text-sm text-red-700">
          {publishError}
        </p>
      ) : null}

      {processError ? (
        <p role="alert" className="text-sm text-red-700">
          {processError}
        </p>
      ) : null}

      {listError ? (
        <p role="alert" className="text-sm text-red-700">
          {listError}
        </p>
      ) : null}

      {documents === null && !listError ? <p>Loading documents…</p> : null}

      {documents && documents.length === 0 ? <p>No documents uploaded yet.</p> : null}

      {documents && documents.length > 0 ? (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Filename</th>
              <th className="py-2">Status</th>
              <th className="py-2">Uploaded</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id} className="border-b">
                <td className="py-2">{document.filename}</td>
                <td className="py-2">
                  {document.status}
                  {document.status === "failed" && document.processingError ? (
                    <p role="alert" className="mt-1 text-xs text-red-700">
                      {document.processingError}
                    </p>
                  ) : null}
                </td>
                <td className="py-2">{new Date(document.uploadedAt).toLocaleString()}</td>
                <td className="py-2">
                  {document.status === "uploaded" || document.status === "processing" ? (
                    <button
                      type="button"
                      onClick={() => handleProcess(document.id)}
                      disabled={processPendingId !== null}
                      className="rounded border px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {processPendingId === document.id
                        ? "Processing…"
                        : document.status === "processing"
                          ? "Recover"
                          : "Process"}
                    </button>
                  ) : null}
                  {document.status === "ready_for_review" ? (
                    <button
                      type="button"
                      onClick={() => handlePublish(document.id)}
                      disabled={publishPendingId === document.id}
                      className="rounded border px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {publishPendingId === document.id ? "Publishing…" : "Publish"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
