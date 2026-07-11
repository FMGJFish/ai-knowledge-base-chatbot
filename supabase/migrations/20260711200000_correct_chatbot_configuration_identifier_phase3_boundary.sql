-- Phase 2 Correction 1 (Chief Software Architect ruling) — restore Phase 3
-- ownership of Public Chatbot Identifier generation.
--
-- implementation_roadmap_v1.md assigns "Public Chatbot Identifier generated
-- and stored on the single Chatbot Configuration row" to Phase 3 —
-- Authentication. The original Phase 2 migration
-- (20260711120006_create_chatbot_configuration.sql) seeded the singleton
-- row while public_chatbot_identifier had `default gen_random_uuid()`,
-- which generated and stored a value at Phase 2 time — completing part of
-- a Phase 3 deliverable early. That applied migration is left unchanged;
-- this is a forward corrective migration, not a rewrite of history.
--
-- The Technical Specification's Database Implementation section states
-- only this field's purpose, not its nullability or default — NOT NULL
-- and the auto-generating default were both implementation-level choices
-- in the original migration, not architectural requirements. Relaxing them
-- here is an implementation correction, not a change to the Technical
-- Specification, ADR, or Roadmap. The unique constraint on this column is
-- preserved and remains compatible with a null value (Postgres unique
-- constraints permit multiple NULLs). The boolean singleton primary key
-- and its CHECK constraint (ADR Decision 016 enforcement) are untouched.

alter table public.chatbot_configuration
  alter column public_chatbot_identifier drop default;

alter table public.chatbot_configuration
  alter column public_chatbot_identifier drop not null;

update public.chatbot_configuration
  set public_chatbot_identifier = null
  where id = true;
