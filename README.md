# AI Knowledge Base Chatbot

Project 01 of the Fisher AI Automation Portfolio Development Program (FAAPDP).

**Implementation status:** Implementation Roadmap Phase 1 — Project Foundation. Business functionality is not yet implemented; see [Implementation Status](#implementation-status) below.

---

## 1. Project Overview

An AI-powered chatbot that lets a business turn an uploaded PDF knowledge base into instant, grounded answers for website visitors, using Retrieval-Augmented Generation (RAG).

## 2. Business Problem

Small businesses answer the same customer questions repeatedly across email, phone, and contact forms. Business knowledge is often scattered across PDFs and documents, and small teams may not have the budget for full-time support staff. See the full Business Requirements in the governance repository: `docs/reference_implementations/project_01_ai_knowledge_base_chatbot/01_business_requirements_v1.md`.

## 3. Solution Overview

An administrator uploads a PDF knowledge base. The system extracts, chunks, and embeds its contents, then makes it available to a website-embeddable chat widget that answers visitor questions using retrieved context and OpenAI, avoiding confident answers when it lacks sufficient information.

## 4. Features

Planned for Version 1 (per `01_business_requirements_v1.md`): PDF upload and processing, semantic retrieval, AI-generated grounded responses, an embeddable website widget, conversation history, an admin dashboard for configuration and testing, and basic usage analytics. Feature-by-feature implementation status is tracked in this repository's roadmap phases (see below).

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

Starts the local development server. At the current implementation stage (Phase 1), this serves only the application foundation — no business functionality is implemented yet.

## 10. Deployment

Deployment targets Vercel, with Staging and Production using separate Supabase projects per ADR Decision 013. Live deployment has not yet been provisioned as of Phase 1 — see `docs/reference_implementations/project_01_ai_knowledge_base_chatbot/project_status_v1.md` in the governance repository for current status.

## 11. Screenshots

Not yet applicable — no user-facing functionality has been implemented.

## 12. Future Enhancements

See `implementation_roadmap_v1.md` (Phases 2–10) in the governance repository for the full build sequence, and `architectural_decision_record_v1.md` for capabilities explicitly deferred beyond Version 1 (multi-tenant support, multiple chatbot configurations, granular role-based authorization, configurable data retention).

## 13. License

Not yet determined.

---

## Implementation Status

This repository is being built according to `implementation_roadmap_v1.md`. Current phase:

- ✅ Phase 1 — Project Foundation
- ⬜ Phase 2 — Database & Infrastructure
- ⬜ Phase 3 — Authentication
- ⬜ Phase 4 — Knowledge Processing Pipeline
- ⬜ Phase 5 — Retrieval Engine
- ⬜ Phase 6 — AI Response Engine
- ⬜ Phase 7 — Public Chat Widget
- ⬜ Phase 8 — Administration Dashboard
- ⬜ Phase 9 — Analytics
- ⬜ Phase 10 — Integration & Validation
