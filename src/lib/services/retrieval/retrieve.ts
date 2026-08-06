import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { embedChunks } from "@/lib/services/knowledge-processing/embedding";
import { getRetrievalConfig } from "./config";

// Retrieval Service (Phase 5, Increment 1; augmented-query construction
// added by A3, Product Improvement Backlog). Owns query embedding, exact
// pgvector similarity search, published-scope enforcement, threshold
// filtering, and top-K selection. Read-only. Does not construct prompts or
// generate responses (AI Response Service, Phase 6) and exposes no route,
// endpoint, or UI (Increment 2, not yet delegated). Also owns constructing
// the bounded, history-augmented retrieval query used for the orchestrator's
// conditional second retrieval attempt (see buildAugmentedRetrievalQuery) --
// still query-string composition, not prompt construction or generation.
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  chunkOrder: number;
  similarity: number;
}

// Reuses embedChunks (knowledge-processing/embedding.ts) unmodified --
// this is what guarantees query embeddings use the identical model as
// ingestion embedding; it is a structural fact, not a convention this
// module has to maintain separately.
//
// Ordering is fully determined by the match_document_chunks SQL function
// (similarity descending); this function performs no re-sorting or
// truncation of its own. An empty array is returned only when the query
// completed successfully and no chunk met the published-scope and
// threshold criteria -- every other failure mode (embedding generation,
// the RPC call itself, an unexpected error) throws and propagates to the
// caller, consistent with the existing repository convention
// (documents-query.ts, publishing.ts, embedding.ts all throw on
// infrastructure failure rather than returning an empty/typed result).
// Bounded character budget for the prior-exchange portion of an augmented
// Phase 2 retrieval query (A3, Product Improvement Backlog). Deliberately
// small relative to a typical question -- this is contextual seasoning for
// the embedding, not a second source of primary signal. Mirrors the
// whole-message-only, never-truncate discipline already established by
// generate.ts's selectBoundedHistory.
const AUGMENTED_QUERY_HISTORY_CHARACTER_BUDGET = 500;

// Constructs the Phase 2 retrieval query (A3): the most recent completed
// exchange -- previous user message, then previous assistant response, in
// chronological order -- followed by the current question in full. The
// current question is never capped or dropped; it is the primary signal
// and must dominate the resulting embedding. If both prior messages
// together exceed the character budget, the user message is dropped
// first (the assistant's answer carries more retrieval-relevant
// vocabulary and is kept preferentially); no message is ever partially
// truncated. Returns the raw question unchanged when no prior exchange is
// available (a conversation's first message has nothing to augment with).
//
// This function only constructs a string. It performs no embedding, no
// retrieval, and no I/O -- callers remain solely responsible for deciding
// when Phase 2 is invoked (Route Handler orchestration, ADR Decision
// 015/021).
export function buildAugmentedRetrievalQuery(
  question: string,
  previousUserMessage: string | null,
  previousAssistantMessage: string | null
): string {
  if (previousUserMessage === null && previousAssistantMessage === null) {
    return question;
  }

  let remaining = AUGMENTED_QUERY_HISTORY_CHARACTER_BUDGET;

  const includeAssistant =
    previousAssistantMessage !== null && previousAssistantMessage.length <= remaining;
  if (includeAssistant) {
    remaining -= previousAssistantMessage!.length;
  }

  const includeUser = previousUserMessage !== null && previousUserMessage.length <= remaining;

  const parts: string[] = [];
  if (includeUser) parts.push(previousUserMessage!);
  if (includeAssistant) parts.push(previousAssistantMessage!);
  parts.push(question);

  return parts.join(" ");
}

export async function retrieveRelevantChunks(query: string): Promise<RetrievedChunk[]> {
  const [queryEmbedding] = await embedChunks([query]);

  if (!queryEmbedding) {
    throw new Error("Query embedding generation returned no result.");
  }

  const { similarityThreshold, topK } = await getRetrievalConfig();

  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: `[${queryEmbedding.join(",")}]`,
    match_threshold: similarityThreshold,
    match_count: topK,
  });

  if (error) {
    throw new Error(`Retrieval query failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    chunkOrder: row.chunk_order,
    similarity: row.similarity,
  }));
}
