-- Phase 2 — Database & Infrastructure
-- Conversations entity (technical_specification_v1.md, Database Implementation).
-- Server-owned conversation identifier paired with the client-generated
-- visitor_session_id (ADR Decision 006); last_activity_at supports the
-- 24-hour inactivity session expiry.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  visitor_session_id uuid not null,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create index conversations_visitor_session_id_idx on public.conversations (visitor_session_id);
create index conversations_last_activity_at_idx on public.conversations (last_activity_at);

alter table public.conversations enable row level security;
