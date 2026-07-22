-- Phase 7, Increment 2 — Layered Rate Limiting and Abuse Protection
-- Atomic counter primitive and bounded stale-row cleanup for
-- rate_limit_counters (phase7_execution_strategy_v1.md, Increment 2
-- Architectural Determinations).

-- Atomic increment-and-evaluate primitive. A single INSERT ... ON CONFLICT
-- ... RETURNING statement, relying on Postgres row-level locking for
-- correctness under concurrent requests -- no read-then-write span, no
-- application-level locking, consistent with the Vercel serverless
-- execution model (ADR Decision 019). window_start is computed here, in
-- SQL, from the database's own clock -- never supplied by the caller --
-- so all concurrent requests within the same window resolve to the same
-- bucket regardless of application-server clock skew. Returns the
-- post-increment count; the caller (the Rate Limit Service) compares it
-- against its own configured threshold -- this function has no notion of
-- "allowed," only "how many requests has this key now made in this
-- window." Runs SECURITY INVOKER (the default) -- an anon/authenticated
-- caller is blocked by rate_limit_counters' RLS (enabled, no policies),
-- identical to every other table in this schema; only the service-role
-- client (which bypasses RLS) can use it.
create or replace function public.increment_rate_limit_counter(
  p_layer text,
  p_key_value text,
  p_window_seconds integer
)
returns table (
  request_count integer,
  window_start timestamptz
)
language plpgsql
as $$
declare
  v_window_start timestamptz;
begin
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  return query
    insert into public.rate_limit_counters (layer, key_value, window_start, request_count)
    values (p_layer, p_key_value, v_window_start, 1)
    on conflict (layer, key_value, window_start)
    do update set
      request_count = rate_limit_counters.request_count + 1,
      updated_at = now()
    returning rate_limit_counters.request_count, rate_limit_counters.window_start;
end;
$$;

-- Bounded global stale-row cleanup. Deletes only a bounded set of rows
-- older than the caller-supplied retention cutoff, selected via a CTE --
-- PostgreSQL has no DELETE ... LIMIT syntax. This is the mechanism that
-- actually bounds table growth from abandoned keys (opportunistic,
-- same-key cleanup alone cannot reach a key that never writes again).
-- Always a separate statement/transaction from
-- increment_rate_limit_counter() above -- never bundled with a rate-limit
-- decision, so a cleanup failure can never affect one. The caller is
-- responsible for supplying a retention cutoff comfortably longer than any
-- configured window duration, so an active-window row is never a
-- candidate for deletion.
create or replace function public.cleanup_stale_rate_limit_counters(
  p_retention_seconds integer,
  p_batch_size integer
)
returns integer
language plpgsql
as $$
declare
  v_deleted_count integer;
begin
  with stale_rows as (
    select id
    from public.rate_limit_counters
    where window_start < now() - make_interval(secs => p_retention_seconds)
    limit p_batch_size
  )
  delete from public.rate_limit_counters
  where id in (select id from stale_rows);

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;
