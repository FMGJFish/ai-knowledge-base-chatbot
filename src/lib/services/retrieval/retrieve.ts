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

// Bounded small-knowledge-base context fallback (ADR:
// adr_gate2d_small_kb_retrieval_fallback.md, A+4 Gate 2D). When the entire
// eligible published knowledge base is small enough to fit safely and
// cheaply within the AI Response Service's prompt envelope, returning it in
// full avoids a narrow-but-supported question being incorrectly excluded by
// semantic-similarity admission filtering against a single blended-topic
// embedding -- the failure mode this ADR documents directly. 6,400 = 2x
// chunking.ts's own TARGET_MAX_CHARS; see the ADR for the full budget
// derivation against generate.ts's PROMPT_ENVELOPE_BUDGET_CHARACTERS. Above
// this ceiling, retrieval behaves exactly as it always has -- this constant
// governs only which branch below executes, nothing else.
const SMALL_KB_CONTEXT_LIMIT = 6_400;

// Placeholder similarity for fallback-returned chunks -- the fallback path
// performs no similarity comparison, so there is no real score to report.
// All fallback chunks share this identical value so that generate.ts's
// buildContextBlock, which sorts by similarity descending before building
// the context block, leaves them in this function's own deterministic order
// rather than reordering them (a stable sort -- guaranteed by the JS spec,
// and Node's actual sort implementation -- never reorders equal elements).
const FALLBACK_SIMILARITY = 1;

interface EligibleKnowledgeBaseSize {
  totalCharacters: number;
  chunkCount: number;
}

// Cheap sizing query only: never selects chunk content or the embedding
// column, just the aggregate. Eligibility (published, embedded) is owned
// entirely by get_eligible_knowledge_base_size() and must stay identical to
// match_document_chunks()'s own eligibility clause -- this function does not
// re-express that condition, it only calls the one place it's defined.
async function getEligibleKnowledgeBaseSize(
  supabase: ReturnType<typeof createServiceClient>
): Promise<EligibleKnowledgeBaseSize> {
  const { data, error } = await supabase.rpc("get_eligible_knowledge_base_size");

  if (error) {
    throw new Error(`Eligible knowledge base size query failed: ${error.message}`);
  }

  const row = data?.[0];

  return {
    totalCharacters: row?.total_characters ?? 0,
    chunkCount: row?.chunk_count ?? 0,
  };
}

// Fetches the complete eligible published knowledge base for the fallback
// path. Never selects the embedding column -- this path performs no vector
// comparison, per the ADR's explicit contract. Two plain, single-table
// queries plus an in-memory sort, deliberately avoiding any PostgREST
// embedded-resource filter/order syntax on a joined table: eligible document
// ids are fetched first, in the required uploaded_at order, then chunks for
// those ids are fetched and sorted client-side by (document upload order,
// chunk_order) -- both orderings the ADR requires so the reconstructed
// context reads as stable source material rather than depending on database
// return order.
async function fetchCompleteEligibleKnowledgeBase(
  supabase: ReturnType<typeof createServiceClient>
): Promise<RetrievedChunk[]> {
  const { data: publishedDocuments, error: documentsError } = await supabase
    .from("documents")
    .select("id, uploaded_at")
    .eq("status", "published")
    .order("uploaded_at", { ascending: true });

  if (documentsError) {
    throw new Error(`Eligible document lookup failed: ${documentsError.message}`);
  }

  const orderedDocumentIds = (publishedDocuments ?? []).map((document) => document.id);

  if (orderedDocumentIds.length === 0) {
    return [];
  }

  const { data: chunks, error: chunksError } = await supabase
    .from("document_chunks")
    .select("id, document_id, content, chunk_order")
    .in("document_id", orderedDocumentIds)
    .not("embedding", "is", null);

  if (chunksError) {
    throw new Error(`Eligible chunk lookup failed: ${chunksError.message}`);
  }

  const documentOrder = new Map(orderedDocumentIds.map((id, index) => [id, index]));

  return (chunks ?? [])
    .slice()
    .sort((a, b) => {
      const documentOrderDelta =
        (documentOrder.get(a.document_id) ?? 0) - (documentOrder.get(b.document_id) ?? 0);

      if (documentOrderDelta !== 0) {
        return documentOrderDelta;
      }

      return a.chunk_order - b.chunk_order;
    })
    .map((chunk) => ({
      chunkId: chunk.id,
      documentId: chunk.document_id,
      content: chunk.content,
      chunkOrder: chunk.chunk_order,
      similarity: FALLBACK_SIMILARITY,
    }));
}

export async function retrieveRelevantChunks(query: string): Promise<RetrievedChunk[]> {
  const supabase = createServiceClient();

  // Sizing check runs before any query embedding is generated -- if the
  // fallback activates, no embedding call is ever made for this request,
  // by construction (the embedChunks call below is reached only in the
  // else-equivalent path that follows).
  const { totalCharacters } = await getEligibleKnowledgeBaseSize(supabase);

  if (totalCharacters <= SMALL_KB_CONTEXT_LIMIT) {
    return fetchCompleteEligibleKnowledgeBase(supabase);
  }

  const [queryEmbedding] = await embedChunks([query]);

  if (!queryEmbedding) {
    throw new Error("Query embedding generation returned no result.");
  }

  const { similarityThreshold, topK } = await getRetrievalConfig();

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
