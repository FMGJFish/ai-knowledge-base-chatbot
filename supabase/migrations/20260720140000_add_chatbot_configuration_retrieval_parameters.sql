-- Phase 5, Increment 1 — Retrieval Capability
-- Adds runtime retrieval tuning parameters to chatbot_configuration
-- (technical_specification_v1.md, Configuration Management: "Application-level
-- configuration ... retrieval parameters"). Both columns are NOT NULL with a
-- default, so the existing single seeded row (Phase 2) receives the approved
-- defaults automatically -- no backfill required. CHECK constraints make an
-- invalid stored value structurally impossible, so the read path never has
-- to validate or reject a value at runtime, only read whatever is present.

alter table public.chatbot_configuration
  add column similarity_threshold double precision not null default 0.75,
  add column top_k integer not null default 5;

alter table public.chatbot_configuration
  add constraint chatbot_configuration_similarity_threshold_range
    check (similarity_threshold > 0 and similarity_threshold <= 1),
  add constraint chatbot_configuration_top_k_positive
    check (top_k > 0);
