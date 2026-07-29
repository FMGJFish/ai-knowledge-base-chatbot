import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { retrieveRelevantChunks } from "@/lib/services/retrieval/retrieve";
import { generateResponse } from "@/lib/services/ai-response/generate";

// Admin Test/Preview Route Handler (Phase 8, Increment 3). Admin-gated,
// stateless invocation surface exercising the Retrieval Service and AI
// Response Service in sequence, per AD-035 (phase8_execution_strategy_v1.md)
// -- no Conversation or Message record is ever created, read, or modified,
// and the Conversation Service is never imported here. The sole Route
// Handler authorized to coordinate the Retrieval Service and the AI
// Response Service for this purpose, per ADR Decision 015 and the Chief
// Systems Architect Decision 001 precedent (Phase 6, Increment 2), whose
// retired verification route (src/app/api/v1/admin/ai-response-verification)
// this permanently supersedes. Boundary validation only: authentication,
// request validation, delegation to each service in sequence, and response
// formatting -- no ranking, filtering, embedding, generation, or persistence
// logic of its own. No history is ever supplied to generateResponse(); each
// request is processed independently (Delegation Package, Section 7).
export async function POST(request: Request) {
  const user = await getAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { question } = body as Record<string, unknown>;

  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "A non-empty question is required" }, { status: 400 });
  }

  const trimmedQuestion = question.trim();

  const chunks = await retrieveRelevantChunks(trimmedQuestion);
  const answer = await generateResponse(trimmedQuestion, chunks);

  return NextResponse.json({ answer, chunks }, { status: 200 });
}
