-- Phase 2 — Database & Infrastructure
-- Messages entity (technical_specification_v1.md, Database Implementation).
-- Immutable historical events owned by their parent Conversation
-- (03_database_design_v1.md), hence cascade delete.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_id_idx on public.messages (conversation_id);
create index messages_conversation_id_created_at_idx on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;
