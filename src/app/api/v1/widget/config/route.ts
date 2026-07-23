import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/services/rate-limit/rate-limit";
import { getClientIp } from "@/lib/services/rate-limit/request";
import { getPublicWidgetConfiguration } from "@/lib/services/widget-config/widget-config";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Widget Bootstrap Configuration resource (Phase 7, Increment 3 --
// AD-028). Public, read-only, unauthenticated: the widget calls this to
// resolve its runtime configuration using the Public Chatbot Identifier
// already delivered via the AD-023 snippet mechanism. Returns only the
// explicit allowlist of public-safe fields (display name, welcome
// message) and creates no authentication or authorization semantics (ADR
// Decision 011). Does not create or validate a conversation, consistent
// with AD-021. Subject to the same layered rate-limiting model
// established in Increment 2 -- the per-client-IP layer is evaluated
// first; an IP-layer rejection returns immediately without touching the
// Public Chatbot Identifier layer at all (phase7_execution_strategy_v1.md,
// Increment 2 Architectural Determinations).
export async function GET(request: Request) {
  const publicChatbotIdentifier = new URL(request.url).searchParams.get("publicChatbotIdentifier");

  if (!publicChatbotIdentifier || !UUID_PATTERN.test(publicChatbotIdentifier)) {
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

  const configuration = await getPublicWidgetConfiguration();

  if (!configuration) {
    return NextResponse.json({ error: "configuration_unavailable" }, { status: 500 });
  }

  return NextResponse.json(configuration, { status: 200 });
}
