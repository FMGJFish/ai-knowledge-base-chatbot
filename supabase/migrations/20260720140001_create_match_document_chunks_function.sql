-- Phase 5, Increment 1 — Retrieval Capability
-- Exact-search similarity function (Establishment Package / Readiness
-- Record: no ANN index for Version 1). Threshold and result count are
-- caller-supplied parameters, not read from chatbot_configuration inside
-- this function -- decoupling storage of the tuning values from execution
-- of the search itself. published-only scope is enforced here, in SQL, via
-- the join to documents -- a non-published chunk is never fetched into
-- application memory, not merely filtered afterward. Read-only: performs
-- no writes. No index is created; this executes as a sequential scan,
-- which is the approved exact-search behavior, not a placeholder for one.

create or replace function public.match_document_chunks(
  query_embedding extensions.vector(1536),
  match_threshold double precision,
  match_count integer
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  chunk_order integer,
  similarity double precision
)
language sql
stable
as $$
  select
    dc.id as chunk_id,
    dc.document_id,
    dc.content,
    dc.chunk_order,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where d.status = 'published'
    and dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) >= match_threshold
  order by dc.embedding <=> query_embedding asc
  limit match_count;
$$;
