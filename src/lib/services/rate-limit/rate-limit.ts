import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import {
  CHATBOT_IDENTIFIER_LAYER_MAX_REQUESTS,
  CHATBOT_IDENTIFIER_LAYER_WINDOW_SECONDS,
  IP_LAYER_MAX_REQUESTS,
  IP_LAYER_WINDOW_SECONDS,
} from "./config";
import { maybeRunCleanupSweep } from "./cleanup";

// Rate Limit Service — layered rate limiting and abuse protection (Phase 7,
// Increment 2). Boundary validation performed at the Route Handler layer,
// not a new named service and no business logic delegated into the
// Conversation Service (phase7_execution_strategy_v1.md, Increment 2
// Boundary / Architectural Determinations). Applied to the Conversations
// and Messages endpoints delivered in Increment 1 only.

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: "ip_layer" | "chatbot_identifier_layer" }
  | { allowed: false; reason: "invalid_chatbot_identifier" };

// Every request reaching the rate-limit boundary consumes IP-layer quota,
// evaluated first. Only a request that passes the IP layer consumes
// Public-Chatbot-Identifier-layer quota -- an IP-layer rejection returns
// immediately without touching the identifier layer at all, so an
// already-blocked source can never erode the shared deployment-level
// identifier quota against unrelated legitimate visitors. The two layers
// remain logically independent -- each layer's counter and decision are
// self-contained once reached -- even though enforcement order is
// sequential (Increment 2 Architectural Determinations: hierarchical
// quota-consumption policy).
export async function enforceRateLimit(
  clientIp: string | null,
  publicChatbotIdentifier: string | null
): Promise<RateLimitResult> {
  // Fire-and-forget: never awaited into the decision path, and its own
  // internal try/catch means it can never throw here either.
  void maybeRunCleanupSweep();

  if (!clientIp) {
    // No trusted IP signal available -- fail closed rather than allow an
    // unattributable request to bypass the IP layer entirely, consistent
    // with this project's existing fail-closed authorization precedent
    // (Phase 3 administrator authentication).
    return { allowed: false, reason: "ip_layer" };
  }

  const ipResult = await incrementAndEvaluateLayer(
    "ip",
    clientIp,
    IP_LAYER_WINDOW_SECONDS,
    IP_LAYER_MAX_REQUESTS
  );

  if (!ipResult.allowed) {
    return { allowed: false, reason: "ip_layer" };
  }

  const resolvedIdentifier = await resolvePublicChatbotIdentifier(publicChatbotIdentifier);

  if (!resolvedIdentifier) {
    return { allowed: false, reason: "invalid_chatbot_identifier" };
  }

  const identifierResult = await incrementAndEvaluateLayer(
    "chatbot_identifier",
    resolvedIdentifier,
    CHATBOT_IDENTIFIER_LAYER_WINDOW_SECONDS,
    CHATBOT_IDENTIFIER_LAYER_MAX_REQUESTS
  );

  if (!identifierResult.allowed) {
    return { allowed: false, reason: "chatbot_identifier_layer" };
  }

  return { allowed: true };
}

// Resolves a client-supplied Public Chatbot Identifier against the
// authoritative Chatbot Configuration row, per ADR Decision 011 ("public
// widgets identify themselves using a non-secret Public Chatbot
// Identifier") -- the server resolves the authoritative configuration from
// this value rather than trusting it directly as the rate-limit key. A
// value that does not resolve returns null; the caller must treat that as
// invalid identification, never as a valid rate-limit key (Increment 2
// Architectural Determinations: Public Chatbot Identifier sourcing).
// Extends without rework to a future multi-tenant Version 2, where
// resolution against the authoritative configuration remains the same
// operation regardless of how many valid identifiers exist.
async function resolvePublicChatbotIdentifier(
  clientSuppliedValue: string | null
): Promise<string | null> {
  if (!clientSuppliedValue) {
    return null;
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("chatbot_configuration")
    .select("public_chatbot_identifier")
    .eq("id", true)
    .single();

  if (error || !data?.public_chatbot_identifier) {
    return null;
  }

  if (data.public_chatbot_identifier !== clientSuppliedValue) {
    return null;
  }

  return data.public_chatbot_identifier;
}

// Atomic increment-and-evaluate for a single layer. The atomicity itself
// lives entirely inside the increment_rate_limit_counter() Postgres
// function -- a single INSERT ... ON CONFLICT ... RETURNING statement --
// relying on Postgres row-level locking for correctness under concurrent
// requests. No read-then-write span exists in this function; it performs
// exactly one round trip and compares the returned count against the
// caller-supplied threshold.
async function incrementAndEvaluateLayer(
  layer: "ip" | "chatbot_identifier",
  keyValue: string,
  windowSeconds: number,
  maxRequests: number
): Promise<{ allowed: boolean }> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .rpc("increment_rate_limit_counter", {
      p_layer: layer,
      p_key_value: keyValue,
      p_window_seconds: windowSeconds,
    })
    .single();

  if (error) {
    throw new Error(`Failed to evaluate ${layer} rate-limit layer: ${error.message}`);
  }

  return { allowed: data.out_request_count <= maxRequests };
}
