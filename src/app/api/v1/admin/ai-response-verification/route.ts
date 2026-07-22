import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { retrieveRelevantChunks } from "@/lib/services/retrieval/retrieve";
import { generateResponse } from "@/lib/services/ai-response/generate";

// Temporary Verification Interface (Phase 6, Increment 2). Admin-gated,
// internal-only invocation surface sufficient to independently verify
// Increment 1 against Phase 6's Completion Criteria -- not a public API,
// not a production chatbot entry point, and not permanent testing
// architecture. This Route Handler is the sole place, per Chief Systems
// Architect Decision 001, authorized to coordinate the Retrieval Service
// and the AI Response Service within one request; neither service calls
// the other. Boundary validation only: authentication, request validation,
// delegation to each service in sequence, and response formatting -- it
// introduces no ranking, filtering, embedding, or generation logic of its
// own.
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

  return NextResponse.json({ answer, chunks });
}
