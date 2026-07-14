-- Phase 4 — Knowledge Processing Pipeline, Increment 1 revision.
-- Provides the structural persistence guarantee for idempotent
-- upload-completion handling: at most one Document may exist per accepted
-- Storage object. Duplicate, retried, or racing completion requests
-- resolve to the same Document via insert-or-lookup against this
-- constraint, rather than through application-level locking alone.

alter table public.documents
  add constraint documents_storage_reference_key unique (storage_reference);
