-- Phase 2 — Database & Infrastructure
-- Supabase Storage bucket for uploaded knowledge documents
-- (technical_specification_v1.md, Solution Structure / Database
-- Implementation). Private: storage.objects has RLS enabled by default on
-- every Supabase project, and no access policies are created here, so only
-- the service role (used server-side) can read or write objects.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
