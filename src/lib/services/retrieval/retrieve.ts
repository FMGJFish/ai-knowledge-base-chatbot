import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { embedChunks } from "@/lib/services/knowledge-processing/embedding";
import { getRetrievalConfig } from "./config";

// Retrieval Service (Phase 5, Increment 1). Owns query embedding, exact
// pgvector similarity search, published-scope enforcement, threshold
// filtering, and top-K selection. Read-only. Does not construct prompts or
// generate responses (AI Response Service, Phase 6) and exposes no route,
// endpoint, or UI (Increment 2, not yet delegated).
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
