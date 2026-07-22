-- Phase 7, Increment 2 — Layered Rate Limiting and Abuse Protection
-- rate_limit_counters entity (phase7_execution_strategy_v1.md, Increment 2
-- Architectural Determinations; ADR Decision 019). One new persistent
-- entity shared by both independently-enforced layers (per client IP, per
-- Public Chatbot Identifier), discriminated by `layer`. One row per
-- (layer, key_value, window_start) -- a fixed-window counter, incremented
-- atomically via increment_rate_limit_counter() (see the companion
-- migration). No other entity is modified.

create table public.rate_limit_counters (
  id uuid primary key default gen_random_uuid(),
  layer text not null check (layer in ('ip', 'chatbot_identifier')),
  key_value text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint rate_limit_counters_layer_key_window_key unique (layer, key_value, window_start)
);

-- Standalone index supporting the bounded global stale-row cleanup sweep
-- (cleanup_stale_rate_limit_counters(), see the companion migration),
-- which scans across all keys rather than a single (layer, key_value)
-- pair -- the composite unique index above cannot serve that scan
-- efficiently since window_start is a trailing column there.
create index rate_limit_counters_window_start_idx on public.rate_limit_counters (window_start);

alter table public.rate_limit_counters enable row level security;
