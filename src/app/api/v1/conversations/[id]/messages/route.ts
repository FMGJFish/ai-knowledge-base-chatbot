import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import {
  getActiveConversation,
  getConversationHistory,
  recordExchange,
} from "@/lib/services/conversation/conversation";
import { retrieveRelevantChunks } from "@/lib/services/retrieval/retrieve";
import { generateResponse } from "@/lib/services/ai-response/generate";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Messages API resource (Phase 7, Increment 1). The sole Route Handler
// authorized to orchestrate the Conversation Service, Retrieval Service,
// and AI Response Service in sequence, per ADR Decision 015 and the Chief
// Systems Architect Decision 001 precedent (Phase 6, Increment 2), now
// extended to a three-service chain. Boundary validation and orchestration
// only -- no ranking, filtering, embedding, generation, or persistence
// logic of its own.
//
// Operates only within an existing, non-expired conversation (ADR Decision
// 020) -- never creates one. An expired or unrecognized conversation
// returns an explicit response directing the client back to the
// Conversations resource, rather than silently creating a replacement.
//
// Temporarily admin-gated -- see conversations/route.ts for rationale;
// removed in Increment 3.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid conversation identifier" }, { status: 400 });
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

  const { content } = body as Record<string, unknown>;

  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "A non-empty content is required" }, { status: 400 });
  }

  const trimmedContent = content.trim();

  const conversation = await getActiveConversation(id);

  if (!conversation) {
    return NextResponse.json({ error: "conversation_not_found_or_expired" }, { status: 404 });
  }

  const history = await getConversationHistory(id);
  const chunks = await retrieveRelevantChunks(trimmedContent);
  const answer = await generateResponse(trimmedContent, chunks, history);

  await recordExchange(id, trimmedContent, answer);

  return NextResponse.json({ answer }, { status: 200 });
}
