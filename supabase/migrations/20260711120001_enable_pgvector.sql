-- Phase 2 — Database & Infrastructure
-- Enables pgvector, required for the 1536-dimension embedding column on
-- document_chunks (technical_specification_v1.md, Database Implementation).

create extension if not exists vector with schema extensions;
