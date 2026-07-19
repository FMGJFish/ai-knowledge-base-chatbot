-- Phase 4, Increment 3 — Asynchronous Knowledge Processing Pipeline.
-- Records the failure reason when a Document transitions to 'failed'
-- during text extraction, chunking, or embedding (ADR Decision 007;
-- Technical Specification Knowledge Ingestion Flow step 9). Null on the
-- successful processing path.

alter table public.documents
  add column processing_error text;
