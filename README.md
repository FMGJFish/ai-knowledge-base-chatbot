# AI Knowledge Base Chatbot

Project 01 of the Fisher AI Automation Portfolio Development Program (FAAPDP).

**Implementation status:** Implementation Roadmap Phases 1–9 — Complete. Phase 10 — Integration & Validation — in progress. Core business functionality (document processing, retrieval, AI responses, the public chat widget, the administration dashboard, and analytics) is implemented and live-verified; see [Implementation Status](#implementation-status) below.

---

## 1. Project Overview

An AI-powered chatbot that lets a business turn an uploaded PDF knowledge base into instant, grounded answers for website visitors, using Retrieval-Augmented Generation (RAG).

## 2. Business Problem

Small businesses answer the same customer questions repeatedly across email, phone, and contact forms. Business knowledge is often scattered across PDFs and documents, and small teams may not have the budget for full-time support staff. See the full Business Requirements in the governance repository: `docs/reference_implementations/project_01_ai_knowledge_base_chatbot/01_business_requirements_v1.md`.

## 3. Solution Overview

An administrator uploads a PDF knowledge base. The system extracts, chunks, and embeds its contents, then makes it available to a website-embeddable chat widget that answers visitor questions using retrieved context and OpenAI, avoiding confident answers when it lacks sufficient information.

## 4. Features

Implemented for Version 1 (per `01_business_requirements_v1.md`), through Implementation Roadmap Phases 1–9:

- Administrator authentication (Supabase Auth-backed sign-in, multiple administrator accounts)
- PDF upload, asynchronous processing, Ready-for-Review status, and explicit administrator publishing
- Semantic retrieval over published knowledge and AI-generated grounded responses, with an insufficient-information fallback when retrieved context does not support an answer
- A public, embeddable website chat widget with anonymous visitor sessions and conversation continuity
- Conversation and message persistence
- An administration dashboard for document management, chatbot configuration, and pre-publication testing
- Usage analytics: event recording, an admin-gated API resource, and an analytics display panel

Phase 10 — Integration & Validation — is in progress: an end-to-end system verification and an architecture/ADR/Technical Specification conformance review, prior to authoring the separate Testing Strategy and Deployment Plan (per ADR Decision 003).

## 5. Technology Stack

Per governance doc `03_technology_stack_v1.md` and `technical_specification_v1.md`:

- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS
- **Backend:** Next.js Route Handlers, Node.js, TypeScript
- **Database:** Supabase PostgreSQL with pgvector
- **Authentication:** Supabase Auth
- **AI:** OpenAI API
- **File Storage:** Supabase Storage
- **Deployment:** Vercel

## 6. System Architecture

This repository implements the architecture approved in the FAAPDP governance repository under `docs/reference_implementations/project_01_ai_knowledge_base_chatbot/`:

- Conceptual Architecture: `02_system_architecture_v1.md`, `03_database_design_v1.md`, `04_api_design_v1.md`, `05_security_review_v1.md`, `06_deployment_architecture_v1.md`, `07_operational_architecture_v1.md`
- Engineering translation: `technical_specification_v1.md`
- Execution sequencing: `implementation_roadmap_v1.md`
- Architectural decisions: `architectural_decision_record_v1.md`

Per ADR Decision 001, the governance repository remains the authoritative source for architecture and governance; this repository is authoritative for source code, build configuration, and deployment assets. See `docs/ARCHITECTURE.md` in this repository for a short pointer back to those source documents.

## 7. Installation

```bash
npm install
```

Requires Node.js (see `package.json` for tooling versions).

## 8. Configuration

Copy `.env.example` to `.env.local` and populate the required values (OpenAI API key, Supabase project URL/keys). See `.env.example` for the full list and `technical_specification_v1.md`'s Configuration Management section for the rationale behind each value. Never commit `.env` or `.env.local`.

## 9. Running the Project

```bash
npm run dev
```

Starts the local development server. The application is fully functional at this stage: an administrator can sign in, upload and publish PDF documents, and test chatbot behavior; the public chat widget serves grounded, AI-generated answers backed by published knowledge, with usage recorded in the admin analytics panel.

## 10. Deployment

Deployment targets Vercel, with Staging and Production using separate Supabase projects per ADR Decision 013. Live deployment has not yet been provisioned as of Phase 1 — see `docs/reference_implementations/project_01_ai_knowledge_base_chatbot/project_status_v1.md` in the governance repository for current status.

## 11. Embed Snippet Generation

A repository-local developer utility (`scripts/generate-embed-snippet.ts`, Phase 7 Increment 3 Task 4D, AD-023) generates the real Public Chat Widget embed snippet. It is never deployed and never reachable over any network path — it must be run directly with Node:

```bash
node scripts/generate-embed-snippet.ts --target=staging
node scripts/generate-embed-snippet.ts --target=production
```

Standalone Node execution does not automatically load `.env.local` — that only happens within Next's own `dev`/`build`/`start` lifecycle — so the required variables must already be present in the shell environment the command runs in.

Each `--target` resolves one complete, isolated deployment profile; it never falls back to this project's generic `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SECRET_KEY`, and never mixes variables across targets.

**`--target=staging` requires:**

- `WIDGET_HOST_STAGING`
- `SUPABASE_URL_STAGING`
- `SUPABASE_SECRET_KEY_STAGING`

**`--target=production` requires:**

- `WIDGET_HOST_PRODUCTION`
- `SUPABASE_URL_PRODUCTION`
- `SUPABASE_SECRET_KEY_PRODUCTION`

Example (bash) — Staging:

```bash
export WIDGET_HOST_STAGING=https://your-staging-app.vercel.app
export SUPABASE_URL_STAGING=https://your-staging-project.supabase.co
export SUPABASE_SECRET_KEY_STAGING=sb_secret_...
node scripts/generate-embed-snippet.ts --target=staging
```

Example (bash) — Production:

```bash
export WIDGET_HOST_PRODUCTION=https://your-production-app.vercel.app
export SUPABASE_URL_PRODUCTION=https://your-production-project.supabase.co
export SUPABASE_SECRET_KEY_PRODUCTION=sb_secret_...
node scripts/generate-embed-snippet.ts --target=production
```

The utility resolves the real `public_chatbot_identifier` from the selected target's own `chatbot_configuration` row — never a placeholder — and renders it into the snippet shape `public/widget-embed.js` actually consumes. See `.env.example` for the full variable list.

## 12. Screenshots

Not included in this repository. The application can be exercised directly via `npm run dev`: the admin dashboard at `/admin`, the chatbot test/preview surface at `/admin/preview`, and the public widget at `/widget?publicChatbotIdentifier=<identifier>`.

## 13. Future Enhancements

See `implementation_roadmap_v1.md` (Phases 2–10) in the governance repository for the full build sequence, and `architectural_decision_record_v1.md` for capabilities explicitly deferred beyond Version 1 (multi-tenant support, multiple chatbot configurations, granular role-based authorization, configurable data retention).

## 14. License

Not yet determined.

---

## Implementation Status

This repository is being built according to `implementation_roadmap_v1.md`. Current phase:

- ✅ Phase 1 — Project Foundation
- ✅ Phase 2 — Database & Infrastructure
- ✅ Phase 3 — Authentication
- ✅ Phase 4 — Knowledge Processing Pipeline
- ✅ Phase 5 — Retrieval Engine
- ✅ Phase 6 — AI Response Engine
- ✅ Phase 7 — Public Chat Widget
- ✅ Phase 8 — Administration Dashboard
- ✅ Phase 9 — Analytics
- 🔄 Phase 10 — Integration & Validation (in progress)
