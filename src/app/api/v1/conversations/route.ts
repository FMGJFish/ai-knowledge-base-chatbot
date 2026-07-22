import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { createConversation } from "@/lib/services/conversation/conversation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Conversations API resource (Phase 7, Increment 1). Creates a new
// conversation for a visitor session, per 04_api_design_v1.md and ADR
// Decision 020 -- conversation creation is exclusively an explicit
// Conversations-resource action; the Messages resource never creates one
// implicitly. Boundary validation only: authentication, request
// validation, delegation to the Conversation Service, and response
// formatting.
//
// Temporarily admin-gated (phase7_execution_strategy_v1.md, Increment 1
// Evaluation requirements: verified using "a temporary, admin-gated
// verification interface mirroring the Phase 5 and Phase 6 pattern"). This
// gate is removed in Increment 3 once layered rate limiting (Increment 2)
// is live and the real anonymous visitor path is ready -- it is not a
// permanent authentication requirement for this resource.
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

  const { visitorSessionId } = body as Record<string, unknown>;

  if (typeof visitorSessionId !== "string" || !UUID_PATTERN.test(visitorSessionId)) {
    return NextResponse.json(
      { error: "A valid UUID visitorSessionId is required" },
      { status: 400 }
    );
  }

  const conversation = await createConversation(visitorSessionId);

  return NextResponse.json({ conversationId: conversation.id }, { status: 201 });
}
