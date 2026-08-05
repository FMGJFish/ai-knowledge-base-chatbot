import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { extractDocumentText } from "./text-extraction";
import { chunkText } from "./chunking";
import { embedChunks } from "./embedding";

// Knowledge Processing Service — asynchronous processing orchestrator
// (Phase 4, Increment 3). Implements Technical Specification Knowledge
// Ingestion Flow steps 4-7 and 9: extract, chunk, embed, persist Document
// Chunks, and transition status to `ready_for_review` on success or
// `failed` on failure. Reaches `ready_for_review` only -- the explicit
// publish action (ADR Decision 007) is a distinct, separate Knowledge
// Management capability outside this increment's boundary.
const DOCUMENTS_BUCKET = "documents";

// Document Chunk persistence batch size (Increment 3, rate-limit/persistence
// resilience follow-up). A single bulk insert of every chunk in a large
// document can exceed this project's effective statement timeout on the
// service-role connection path -- confirmed directly against Staging using
// realistic-size rows (full 1536-dim embedding literals + 500-800 token
// content, matching embedding.ts/chunking.ts): 2,000 rows (~40 MB payload)
// completed in ~23s, while 3,000 rows (~60 MB) failed with Postgres 57014
// ("canceling statement due to statement timeout") at ~44s. 500 is chosen
// with wide margin below that measured failure point -- roughly a quarter
// of the last confirmed-successful size -- so batches stay fast (single-digit
// seconds) and leave headroom for real-world network/DB variance. It also
// matches embedding.ts's own MAX_ITEMS_PER_REQUEST, keeping the embed and
// persist stages on the same batch granularity.
const CHUNK_PERSIST_BATCH_SIZE = 500;

// Stale-processing recovery threshold (Document Processing Reliability and
// Recovery correction, Finding #1). A `processing` Document whose lease
// (processing_started_at) is older than this is treated as abandoned -- no
// legitimate invocation for the approved supported workload can still be
// running past this point. Chief Systems Architect-approved value (Delegation
// Authority Amendment 1) -- derived from four live Staging measurements
// against this Vercel Hobby deployment (300s hard ceiling), documented in
// docs/session_records/project01_document_processing_reliability_delegation_package.md:
// 169 chunks/7.1s, 678 chunks/12.8s, 1,356 chunks/29.1s, 2,754 chunks/96s.
// Scaling was non-linear (accelerating) at the largest tested size, so this
// value is anchored to the largest DIRECTLY MEASURED point (96s), not
// extrapolated beyond it: 180s leaves ~84s (87%) headroom above that
// measurement for execution-time variance, while remaining well under the
// 300s ceiling.
const STALE_PROCESSING_THRESHOLD_MS = 180_000;

export type ProcessDocumentResult =
  | { status: "ready_for_review"; documentId: string; chunkCount: number }
  | { status: "failed"; documentId: string; reason: string }
  | { status: "skipped"; documentId: string; currentStatus: string };

// Distinguishes "no such Document" from every other failure mode, so a
// caller (the administrator-initiated processing route) can narrowly map
// this one case to a repository-consistent not-found response without a
// broad catch that would also swallow genuine, unexpected defects.
export class DocumentNotFoundError extends Error {
  constructor(documentId: string) {
    super(`Document not found for processing: ${documentId}.`);
    this.name = "DocumentNotFoundError";
  }
}

// Truncates and strips an error to a short, admin-safe description. Never
// includes a stack trace, provider response body, secret, or token --
// the error classes in text-extraction.ts and embedding.ts are already
// written to throw safe messages, but this is a second, defensive layer
// in case a future failure path throws something less careful.
function toSafeErrorDescription(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown processing error.";
  return message.slice(0, 500);
}

export async function processDocument(documentId: string): Promise<ProcessDocumentResult> {
  const supabase = createServiceClient();

  // Atomic claim: the guarded update itself is the concurrency control, not
  // a prior read-then-write. Only a row currently in `uploaded` transitions
  // to `processing`, and it does so for at most one caller -- a concurrent
  // second invocation's identical update matches zero rows and must not
  // proceed into extraction, chunking, embedding, or persistence. This
  // mirrors the guarded-update-then-reconcile pattern already established
  // by publishDocument() (publishing.ts) for the same class of race on the
  // `ready_for_review` -> `published` transition.
  const { data: claimed, error: claimError } = await supabase
    .from("documents")
    .update({ status: "processing", processing_started_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("status", "uploaded")
    .select()
    .maybeSingle();

  if (claimError) {
    throw new Error(`Failed to claim Document ${documentId} for processing: ${claimError.message}`);
  }

  let document = claimed;

  if (!document) {
    // Zero rows matched at the fresh-claim attempt: either the Document does
    // not exist, it is not currently in `uploaded`, or a concurrent
    // invocation already won the claim. Before reconciling to `skipped`,
    // attempt a second, equally atomic reclaim for a `processing` Document
    // whose lease has gone stale (Document Processing Reliability and
    // Recovery correction, Finding #1) -- the identical guarded-update
    // pattern as the fresh claim above: only a `processing` row whose lease
    // predates the staleness cutoff transitions, and it does so for at most
    // one caller. A null `processing_started_at` (a Document already stuck
    // in `processing` from before this mechanism existed) is treated as
    // equally eligible: no legitimate claim under this mechanism can ever
    // have a null lease, so its absence cannot indicate an active invocation.
    const staleCutoff = new Date(Date.now() - STALE_PROCESSING_THRESHOLD_MS).toISOString();

    const { data: reclaimed, error: reclaimError } = await supabase
      .from("documents")
      .update({ status: "processing", processing_started_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("status", "processing")
      .or(`processing_started_at.is.null,processing_started_at.lt.${staleCutoff}`)
      .select()
      .maybeSingle();

    if (reclaimError) {
      throw new Error(
        `Failed to reclaim stale Document ${documentId} for processing: ${reclaimError.message}`
      );
    }

    document = reclaimed;
  }

  if (!document) {
    // Still zero rows matched: either the Document does not exist, or it is
    // in a state this attempt was not eligible to claim (already
    // `ready_for_review`/`failed`/`published`, or a `processing` Document
    // whose lease has not yet gone stale -- still legitimately in flight).
    // Reconciled against ground truth, never assumed, exactly as
    // publishDocument() already does for its own guarded update.
    const { data: current, error: fetchError } = await supabase
      .from("documents")
      .select("status")
      .eq("id", documentId)
      .maybeSingle();

    if (fetchError) {
      throw new Error(
        `Failed to look up Document ${documentId} after claim attempt: ${fetchError.message}`
      );
    }

    if (!current) {
      throw new DocumentNotFoundError(documentId);
    }

    return { status: "skipped", documentId, currentStatus: current.status };
  }

  try {
    if (!document.storage_reference) {
      throw new Error(`Document ${documentId} has no storage_reference to process.`);
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .download(document.storage_reference);

    if (downloadError || !fileData) {
      throw new Error("Stored PDF object could not be retrieved.");
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const { text } = await extractDocumentText(buffer);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      // Structurally valid PDF, no meaningful extractable text (e.g.
      // scanned/image-only) -- per the approved boundary, this fails
      // rather than reaching ready_for_review. OCR is out of scope.
      throw new Error("No extractable text was found in this document.");
    }

    const embeddings = await embedChunks(chunks.map((chunk) => chunk.content));

    if (embeddings.length !== chunks.length) {
      throw new Error("Embedding count did not match chunk count.");
    }

    const chunkRows = chunks.map((chunk, index) => {
      const embedding = embeddings[index];
      if (!embedding) {
        throw new Error(`Missing embedding for chunk ${index}.`);
      }
      return {
        document_id: documentId,
        content: chunk.content,
        chunk_order: chunk.chunkOrder,
        embedding: `[${embedding.join(",")}]`,
      };
    });

    // Persisted in fixed-size batches (CHUNK_PERSIST_BATCH_SIZE) rather than
    // one statement for the whole document -- see that constant for the
    // measured evidence behind the size. Each individual batch insert is
    // already atomic (a single INSERT statement), so per-batch transactional
    // correctness needs no extra work. Document-level atomicity -- the
    // property the prior single-insert version got for free -- is restored
    // explicitly here: if any batch fails, every chunk already persisted for
    // this Document in this attempt is deleted before the error propagates,
    // so a failed Document never carries a partial chunk set. Combined with
    // the unique (document_id, chunk_order) index, this also rules out
    // duplicate chunk rows on a retried attempt.
    for (let start = 0; start < chunkRows.length; start += CHUNK_PERSIST_BATCH_SIZE) {
      const batch = chunkRows.slice(start, start + CHUNK_PERSIST_BATCH_SIZE);
      const { error: insertChunksError } = await supabase.from("document_chunks").insert(batch);

      if (insertChunksError) {
        await supabase.from("document_chunks").delete().eq("document_id", documentId);
        throw new Error("Failed to persist Document Chunks.");
      }
    }

    // Successful processing explicitly clears processing_error to null --
    // relevant if this Document was previously retried after a failure
    // (a stale error description must never linger on a since-succeeded
    // Document). processing_started_at is cleared in the same update: the
    // lease's purpose ends the moment processing leaves `processing` for
    // any terminal reason (Document Processing Reliability and Recovery
    // correction, Finding #1) -- a non-null lease has meaning only while
    // status = 'processing'.
    const { error: markReadyError } = await supabase
      .from("documents")
      .update({ status: "ready_for_review", processing_error: null, processing_started_at: null })
      .eq("id", documentId);

    if (markReadyError) {
      throw new Error("Failed to transition Document to ready_for_review.");
    }

    return { status: "ready_for_review", documentId, chunkCount: chunks.length };
  } catch (error) {
    const reason = toSafeErrorDescription(error);

    // processing_started_at is cleared here too -- the failure transition is
    // the other terminal exit from `processing` (Finding #1); the lease must
    // not linger on a Document that is no longer being processed.
    await supabase
      .from("documents")
      .update({ status: "failed", processing_error: reason, processing_started_at: null })
      .eq("id", documentId);

    return { status: "failed", documentId, reason };
  }
}
