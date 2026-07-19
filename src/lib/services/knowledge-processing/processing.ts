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

export type ProcessDocumentResult =
  | { status: "ready_for_review"; documentId: string; chunkCount: number }
  | { status: "failed"; documentId: string; reason: string }
  | { status: "skipped"; documentId: string; currentStatus: string };

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

  const { data: document, error: fetchError } = await supabase
    .from("documents")
    .select()
    .eq("id", documentId)
    .single();

  if (fetchError || !document) {
    throw new Error(`Document not found for processing: ${documentId}.`);
  }

  if (!document.storage_reference) {
    throw new Error(`Document ${documentId} has no storage_reference to process.`);
  }

  // Idempotency guard: the trigger may legitimately fire more than once for
  // the same Document (e.g. a retried internal call). Only a Document still
  // in `uploaded` status is eligible to start processing -- this prevents a
  // second invocation from clobbering a Document that has already reached
  // `processing`, `ready_for_review`, or `failed`.
  if (document.status !== "uploaded") {
    return { status: "skipped", documentId, currentStatus: document.status };
  }

  const { error: markProcessingError } = await supabase
    .from("documents")
    .update({ status: "processing" })
    .eq("id", documentId);

  if (markProcessingError) {
    throw new Error(`Failed to transition Document ${documentId} to processing.`);
  }

  try {
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
    // Document).
    const { error: markReadyError } = await supabase
      .from("documents")
      .update({ status: "ready_for_review", processing_error: null })
      .eq("id", documentId);

    if (markReadyError) {
      throw new Error("Failed to transition Document to ready_for_review.");
    }

    return { status: "ready_for_review", documentId, chunkCount: chunks.length };
  } catch (error) {
    const reason = toSafeErrorDescription(error);

    await supabase
      .from("documents")
      .update({ status: "failed", processing_error: reason })
      .eq("id", documentId);

    return { status: "failed", documentId, reason };
  }
}
