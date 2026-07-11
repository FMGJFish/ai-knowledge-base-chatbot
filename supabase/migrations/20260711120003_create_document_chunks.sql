-- Phase 2 — Database & Infrastructure
-- Document Chunks entity (technical_specification_v1.md, Database Implementation).
-- embedding is vector(1536), matching the selected embedding model
-- (OpenAI text-embedding-3-small). Chunks are derived/reproducible data owned
-- by their source Document (03_database_design_v1.md), hence cascade delete.

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  content text not null,
  embedding extensions.vector(1536),
  chunk_order integer not null
);

create index document_chunks_document_id_idx on public.document_chunks (document_id);
create unique index document_chunks_document_id_chunk_order_key
  on public.document_chunks (document_id, chunk_order);

alter table public.document_chunks enable row level security;
