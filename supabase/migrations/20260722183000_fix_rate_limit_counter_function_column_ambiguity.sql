-- Phase 7, Increment 2 Correction 1 — fix increment_rate_limit_counter()
-- column ambiguity.
--
-- The original migration (20260722182835_create_rate_limit_counter_functions.sql)
-- declared increment_rate_limit_counter() with RETURNS TABLE output columns
-- named request_count and window_start -- identical to
-- rate_limit_counters' own column names. Postgres raised
-- "column reference \"window_start\" is ambiguous" when the function's
-- `on conflict (layer, key_value, window_start)` clause tried to resolve
-- window_start, since it could refer to either the PL/pgSQL output
-- variable or the table column. Caught during direct verification of the
-- atomic increment operation, before any application code was written
-- against it. That applied migration is left unchanged; this is a forward
-- corrective migration, not a rewrite of history (see
-- 20260711200000_correct_chatbot_configuration_identifier_phase3_boundary.sql
-- for the established precedent).
--
-- Correction: rename the function's output columns (out_request_count,
-- out_window_start) so they cannot collide with rate_limit_counters' own
-- column names. No change to the table, its constraints, or
-- cleanup_stale_rate_limit_counters(), which had no such collision.

drop function if exists public.increment_rate_limit_counter(text, text, integer);

create or replace function public.increment_rate_limit_counter(
  p_layer text,
  p_key_value text,
  p_window_seconds integer
)
returns table (
  out_request_count integer,
  out_window_start timestamptz
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
