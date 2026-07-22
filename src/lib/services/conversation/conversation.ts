import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

// Conversation Service (Phase 7, Increment 1). Owns conversation and
// message persistence and prior-message retrieval only
// (phase7_execution_strategy_v1.md, Increment 1 Boundary). Never calls the
// Retrieval Service or AI Response Service directly -- cross-service
// coordination happens exclusively at the Messages Route Handler, per ADR
// Decision 015. Reads and writes only against `conversations` and
// `messages`.

// ADR Decision 006 -- 24-hour inactivity expiry.
const SESSION_INACTIVITY_EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// Always creates a new conversation -- this module performs no
// lookup-and-reuse of a prior conversation for the same
// visitor_session_id, consistent with ADR Decision 020: conversation
// creation is exclusively an explicit Conversations-resource action, never
// inferred or implicit.
export async function createConversation(visitorSessionId: string): Promise<{ id: string }> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("conversations")
    .insert({ visitor_session_id: visitorSessionId })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create conversation: ${error.message}`);
  }

  return { id: data.id };
}

// Returns the conversation if it exists and has not exceeded the 24-hour
// inactivity expiry; otherwise null. Per ADR Decision 020, an expired or
// missing conversation is never silently recreated here -- the caller (the
// Messages Route Handler) is responsible for returning the approved
// explicit response directing the client back to the Conversations
// resource.
export async function getActiveConversation(
  conversationId: string
): Promise<{ id: string } | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("id, last_activity_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read conversation: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const lastActivity = new Date(data.last_activity_at).getTime();

  if (Date.now() - lastActivity > SESSION_INACTIVITY_EXPIRY_MS) {
    return null;
  }

  return { id: data.id };
}

// Returns prior messages for the conversation in chronological order, for
// the Messages Route Handler to supply to the AI Response Service as
// conversation history (technical_specification_v1.md, AI Integration).
export async function getConversationHistory(
  conversationId: string
): Promise<ConversationMessage[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to read conversation history: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content,
  }));
}

// Persists the user's message and the assistant's response, then refreshes
// the conversation's last_activity_at, extending its 24-hour inactivity
// window. Both messages are recorded together so a completed exchange is
// never left with only one side persisted.
export async function recordExchange(
  conversationId: string,
  userContent: string,
  assistantContent: string
): Promise<void> {
  const supabase = createServiceClient();

  const { error: messagesError } = await supabase.from("messages").insert([
    { conversation_id: conversationId, role: "user", content: userContent },
    { conversation_id: conversationId, role: "assistant", content: assistantContent },
  ]);

  if (messagesError) {
    throw new Error(`Failed to persist conversation exchange: ${messagesError.message}`);
  }

  const { error: touchError } = await supabase
    .from("conversations")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", conversationId);

  if (touchError) {
    throw new Error(`Failed to update conversation activity: ${touchError.message}`);
  }
}
