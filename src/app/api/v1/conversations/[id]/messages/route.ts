import { NextResponse, after } from "next/server";
import {
  getActiveConversation,
  getConversationHistory,
  recordExchange,
} from "@/lib/services/conversation/conversation";
import { retrieveRelevantChunks, buildAugmentedRetrievalQuery } from "@/lib/services/retrieval/retrieve";
import { generateResponse } from "@/lib/services/ai-response/generate";
import { enforceRateLimit } from "@/lib/services/rate-limit/rate-limit";
import { getClientIp } from "@/lib/services/rate-limit/request";
import { recordEvent } from "@/lib/services/analytics/analytics";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Conversation Input and Context Safety correction (Independent Review
// Finding #3). Maximum length for a single submitted message, enforced
// before any downstream service call. Generous for any real question (a
// detailed multi-paragraph question is well under this), while preventing
// an unbounded paste from ever reaching the Conversation Service, Retrieval
// Service, or AI Response Service.
const MAX_MESSAGE_CHARACTERS = 4_000;

// Messages API resource (Phase 7, Increments 1-3; conditional second
// retrieval attempt added by A3, Product Improvement Backlog). The sole
// Route Handler authorized to orchestrate the Conversation Service,
// Retrieval Service, and AI Response Service in sequence, per ADR Decision
// 015 and the Chief Systems Architect Decision 001 precedent (Phase 6,
// Increment 2), now extended to a three-service chain. Boundary validation,
// layered rate-limit enforcement, and orchestration only -- no ranking,
// filtering, embedding, generation, or persistence logic of its own. The
// decision of *whether* a second retrieval attempt occurs is orchestration
// (this Route Handler, based on Phase 1's result); the query string used for
// that attempt is composed by Retrieval Service itself
// (buildAugmentedRetrievalQuery), consistent with that boundary.
//
// Operates only within an existing, non-expired conversation (ADR Decision
// 020) -- never creates one. An expired or unrecognized conversation
// returns an explicit response directing the client back to the
// Conversations resource, rather than silently creating a replacement.
//
// Public and unauthenticated -- see conversations/route.ts for the
// Increment 3 rationale (Increment 1's Applied Interpretation).
//
// Rate-limit enforcement (Phase 7, Increment 2): the per-client-IP layer
// is evaluated first; an IP-layer rejection returns immediately without
// touching the Public Chatbot Identifier layer at all
// (phase7_execution_strategy_v1.md, Increment 2 Architectural
// Determinations -- hierarchical quota-consumption policy).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { content, publicChatbotIdentifier } = body as Record<string, unknown>;

  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "A non-empty content is required" }, { status: 400 });
  }

  const trimmedContent = content.trim();

  if (trimmedContent.length > MAX_MESSAGE_CHARACTERS) {
    return NextResponse.json(
      {
        error: `Message exceeds the maximum allowed length of ${MAX_MESSAGE_CHARACTERS} characters`,
      },
      { status: 400 }
    );
  }

  if (typeof publicChatbotIdentifier !== "string" || !UUID_PATTERN.test(publicChatbotIdentifier)) {
    return NextResponse.json(
      { error: "A valid UUID publicChatbotIdentifier is required" },
      { status: 400 }
    );
  }

  const rateLimitResult = await enforceRateLimit(getClientIp(request), publicChatbotIdentifier);

  if (!rateLimitResult.allowed) {
    if (rateLimitResult.reason === "invalid_chatbot_identifier") {
      return NextResponse.json({ error: "invalid_chatbot_identifier" }, { status: 400 });
    }

    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const conversation = await getActiveConversation(id);

  if (!conversation) {
    return NextResponse.json({ error: "conversation_not_found_or_expired" }, { status: 404 });
  }

  const history = await getConversationHistory(id);
  let chunks = await retrieveRelevantChunks(trimmedContent);

  // A3 (Product Improvement Backlog): Phase 2, conditional retrieval retry.
  // Triggers only when Phase 1 (the unmodified question alone, above)
  // returns zero qualifying chunks -- every request that already retrieves
  // successfully takes the exact same path it takes today. History is
  // strict alternating user/assistant pairs (recordExchange, ADR Decision
  // 021), chronologically ascending; the most recent completed exchange is
  // therefore the last two entries.
  if (chunks.length === 0 && history.length >= 2) {
    const previousAssistantMessage = history[history.length - 1]!.content;
    const previousUserMessage = history[history.length - 2]!.content;

    const augmentedQuery = buildAugmentedRetrievalQuery(
      trimmedContent,
      previousUserMessage,
      previousAssistantMessage
    );

    const augmentedChunks = await retrieveRelevantChunks(augmentedQuery);

    console.log(
      JSON.stringify({
        event: "retrieval_phase_two_triggered",
        conversationId: id,
        phaseTwoQualifyingChunks: augmentedChunks.length,
      })
    );

    chunks = augmentedChunks;
  }

  const answer = await generateResponse(trimmedContent, chunks, history, id);

  await recordExchange(id, trimmedContent, answer);

  after(async () => {
    try {
      await recordEvent({
        eventType: "message_exchanged",
        referenceId: id,
        referenceType: "conversation",
      });
    } catch {
      // Best-effort, non-blocking (Phase 9 Increment 2 boundary).
    }
  });

  return NextResponse.json({ answer }, { status: 200 });
}
