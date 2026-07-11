-- Phase 2 — Database & Infrastructure
-- Chatbot Configuration entity (technical_specification_v1.md, Database
-- Implementation). Per ADR Decision 016, exactly one row exists per
-- deployment. The boolean primary key fixed to `true`, combined with the
-- check constraint, makes a second row impossible at the database level
-- (a `false` row is rejected by the check; only one `true` value can exist
-- under a primary key) rather than relying on application-level enforcement.

create table public.chatbot_configuration (
  id boolean primary key default true,
  public_chatbot_identifier uuid not null default gen_random_uuid(),
  name text not null default 'Chatbot',
  welcome_message text,
  instructions text,
  constraint chatbot_configuration_singleton check (id),
  constraint chatbot_configuration_public_chatbot_identifier_key unique (public_chatbot_identifier)
);

alter table public.chatbot_configuration enable row level security;

-- Seed the single required row so later phases (Authentication, Administration)
-- have a row to read/update rather than needing first-run creation logic.
insert into public.chatbot_configuration (id)
values (true)
on conflict (id) do nothing;
