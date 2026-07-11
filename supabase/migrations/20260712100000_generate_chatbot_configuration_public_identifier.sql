-- Phase 3 — Authentication
-- Generates and stores the Public Chatbot Identifier on the existing
-- singleton Chatbot Configuration row, per implementation_roadmap_v1.md's
-- Phase 3 deliverable ("Public Chatbot Identifier generated and stored on
-- the single Chatbot Configuration row, usable for public widget
-- initialization") and ADR Decisions 011 and 016.
--
-- Phase 2's forward correction (20260711200000...) intentionally left this
-- column null, since generating it was a Phase 3 action, not Phase 2's.
-- This migration is the explicit Phase 3 action restoring that value —
-- forward-only, idempotent (only fills a currently-null value), and does
-- not alter the singleton enforcement mechanism (boolean primary key,
-- CHECK constraint) established in Phase 2.
--
-- The identifier is a stable, non-secret uuid: it identifies the single
-- deployed chatbot for public widget initialization (ADR Decision 011)
-- and is not a discriminator among multiple configurations (ADR Decision
-- 016), and it is not used as an authentication credential.

update public.chatbot_configuration
set public_chatbot_identifier = gen_random_uuid()
where id = true
  and public_chatbot_identifier is null;
