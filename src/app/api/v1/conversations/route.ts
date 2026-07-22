import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { createConversation } from "@/lib/services/conversation/conversation";
import { enforceRateLimit } from "@/lib/services/rate-limit/rate-limit";
import { getClientIp } from "@/lib/services/rate-limit/request";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Conversations API resource (Phase 7, Increments 1-2). Creates a new
// conversation for a visitor session, per 04_api_design_v1.md and ADR
// Decision 020 -- conversation creation is exclusively an explicit
// Conversations-resource action; the Messages resource never creates one
// implicitly. Boundary validation only: authentication, request
// validation, layered rate-limit enforcement, delegation to the
// Conversation Service, and response formatting.
//
// Temporarily admin-gated (phase7_execution_strategy_v1.md, Increment 1
// Evaluation requirements: verified using "a temporary, admin-gated
// verification interface mirroring the Phase 5 and Phase 6 pattern"). This
// gate is removed in Increment 3 once the real anonymous visitor path is
// ready -- it is not a permanent authentication requirement for this
// resource.
//
// Rate-limit enforcement (Phase 7, Increment 2): the per-client-IP layer
// is evaluated first; an IP-layer rejection returns immediately without
// touching the Public Chatbot Identifier layer at all
// (phase7_execution_strategy_v1.md, Increment 2 Architectural
// Determinations -- hierarchical quota-consumption policy).
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

  const { visitorSessionId, publicChatbotIdentifier } = body as Record<string, unknown>;

  if (typeof visitorSessionId !== "string" || !UUID_PATTERN.test(visitorSessionId)) {
    return NextResponse.json(
      { error: "A valid UUID visitorSessionId is required" },
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

  const conversation = await createConversation(visitorSessionId);

  return NextResponse.json({ conversationId: conversation.id }, { status: 201 });
}
