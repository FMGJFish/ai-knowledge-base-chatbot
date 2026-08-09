-- A+4 Gate 2D — Bounded Small-Knowledge-Base Retrieval Fallback
-- (docs/reference_implementations/project_01_ai_knowledge_base_chatbot/
-- adr_gate2d_small_kb_retrieval_fallback.md). Read-only aggregate function
-- letting the Retrieval Service determine, in one cheap query, whether the
-- entire eligible published knowledge base is small enough to bypass
-- semantic-similarity admission filtering. Eligibility semantics are
-- identical to, and must be kept in sync with, match_document_chunks()
-- (20260720140001_create_match_document_chunks_function.sql):
-- documents.status = 'published' AND document_chunks.embedding IS NOT NULL.
-- Never selects the embedding column itself -- this function answers a
-- sizing question, not a similarity question. No table, column, or index
-- change; mutates nothing.

create or replace function public.get_eligible_knowledge_base_size()
returns table (
  total_characters bigint,
  chunk_count bigint
)
language sql
stable
as $$
  select
    coalesce(sum(char_length(dc.content)), 0)::bigint as total_characters,
    count(*)::bigint as chunk_count
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where d.status = 'published'
    and dc.embedding is not null;
$$;
