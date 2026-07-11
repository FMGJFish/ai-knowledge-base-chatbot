-- Phase 2 — Database & Infrastructure
-- Documents entity (technical_specification_v1.md, Database Implementation).
-- Status lifecycle per ADR Decision 007: uploaded -> processing ->
-- ready_for_review -> published, with failed reachable from uploaded or processing.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready_for_review', 'published', 'failed')),
  uploaded_at timestamptz not null default now(),
  storage_reference text
);

create index documents_status_idx on public.documents (status);

alter table public.documents enable row level security;
