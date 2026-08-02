import { NextResponse, after } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import {
  DocumentNotFoundError,
  processDocument,
} from "@/lib/services/knowledge-processing/processing";
import { recordEvent } from "@/lib/services/analytics/analytics";

// Documents API resource -- administrator-initiated processing retry
// (Phase 8, Increment 3 bounded recovery correction). Recovers a Document
// stuck in `uploaded` when the automatic asynchronous trigger
// (confirmDocumentIntake -> after() -> internal Route Handler) never
// completed, without requiring INTERNAL_SERVICE_SECRET. Calls
// processDocument() directly, in-process -- this handler never calls the
// internal Route Handler and never reads or returns the internal secret.
// processDocument()'s own status guard (only a Document in `uploaded`
// proceeds; anything else returns `skipped`) is the sole idempotency
// mechanism here, exactly as it already is for the automatic trigger --
// this route adds no guard or processing logic of its own.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid document identifier" }, { status: 400 });
  }

  // Only the specific not-found case is narrowly translated to a
  // repository-consistent 404; every other error is rethrown unchanged so
  // an unexpected defect still surfaces as-is rather than being masked.
  try {
    const result = await processDocument(id);

    if (result.status === "ready_for_review") {
      after(async () => {
        try {
          await recordEvent({
            eventType: "document_processed",
            referenceId: id,
            referenceType: "document",
          });
        } catch {
          // Best-effort, non-blocking (Phase 9 Increment 2 boundary).
        }
      });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    throw error;
  }
}
