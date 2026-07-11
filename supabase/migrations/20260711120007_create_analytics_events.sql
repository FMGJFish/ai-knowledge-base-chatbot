-- Phase 2 — Database & Infrastructure
-- Analytics Events entity (technical_specification_v1.md, Database
-- Implementation). reference_id/reference_type is a polymorphic pointer to
-- a Document, Conversation, or Message (03_database_design_v1.md), so no
-- single foreign key constraint applies.

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  reference_id uuid,
  reference_type text,
  occurred_at timestamptz not null default now()
);

create index analytics_events_event_type_idx on public.analytics_events (event_type);
create index analytics_events_occurred_at_idx on public.analytics_events (occurred_at);
create index analytics_events_reference_idx on public.analytics_events (reference_type, reference_id);

alter table public.analytics_events enable row level security;
