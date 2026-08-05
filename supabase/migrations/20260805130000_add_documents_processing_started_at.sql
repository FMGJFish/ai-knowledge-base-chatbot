-- Document Processing Reliability and Recovery correction (Finding #1).
-- Active processing-lease timestamp, not historical metadata: set only when
-- a claim (fresh uploaded->processing, or a stale reclaim) succeeds, and
-- cleared to null at both terminal transitions out of `processing`
-- (ready_for_review and failed). Meaningful only while status='processing'.
-- Additive only -- no data migration required; existing rows default to null.
alter table public.documents add column processing_started_at timestamptz;
