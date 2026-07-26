import type { PublicWidgetConfiguration } from "@/lib/contracts/widget-config";

// Minimal browser-side networking layer for the Public Chat Widget
// (Phase 7, Increment 3, Task 4A). This is the first browser-side API
// consumer in the codebase -- no prior client fetch wrapper or response
// envelope exists to reuse. Kept intentionally thin: it only calls the
// three endpoints already delivered and evaluated in Tasks 1-2, performs
// no persistence, and introduces no new backend capability. Later
// slices (Task 4B, Task 4C) may extend this module rather than
// introducing a parallel one.

export type ApiErrorKind =
  | "invalid_identifier"
  | "rate_limited"
  | "conversation_expired"
  | "malformed_response"
  | "network_error"
  | "unknown_error";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; kind: ApiErrorKind };

async function parseJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function classifyErrorResponse(status: number, body: unknown): ApiErrorKind {
  const errorCode =
    typeof body === "object" && body !== null && "error" in body
      ? (body as Record<string, unknown>).error
      : undefined;

  if (status === 429 || errorCode === "rate_limited") {
    return "rate_limited";
  }

  if (errorCode === "invalid_chatbot_identifier") {
    return "invalid_identifier";
  }

  // The Messages resource's explicit rejection for a missing or expired
  // conversation (ADR Decision 020; consumed here per AD-029). Transport
  // and classification only -- this module does not clear storage,
  // create a replacement conversation, resubmit, or decide UI behavior;
  // that orchestration belongs to widget-app.tsx.
  if (status === 404 && errorCode === "conversation_not_found_or_expired") {
    return "conversation_expired";
  }

  return "unknown_error";
}

export async function fetchWidgetConfig(
  publicChatbotIdentifier: string
): Promise<ApiResult<PublicWidgetConfiguration>> {
  let response: Response;

  try {
    response = await fetch(
      `/api/v1/widget/config?publicChatbotIdentifier=${encodeURIComponent(publicChatbotIdentifier)}`
    );
  } catch {
    return { ok: false, kind: "network_error" };
  }

  const body = await parseJsonBody(response);

  if (!response.ok) {
    return { ok: false, kind: classifyErrorResponse(response.status, body) };
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).name !== "string"
  ) {
    return { ok: false, kind: "malformed_response" };
  }

  const record = body as Record<string, unknown>;
  const welcomeMessage = record.welcomeMessage;

  return {
    ok: true,
    data: {
      name: record.name as string,
      welcomeMessage: typeof welcomeMessage === "string" ? welcomeMessage : null,
    },
  };
}

export async function createConversation(
  visitorSessionId: string,
  publicChatbotIdentifier: string
): Promise<ApiResult<{ conversationId: string }>> {
  let response: Response;

  try {
    response = await fetch("/api/v1/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorSessionId, publicChatbotIdentifier }),
    });
  } catch {
    return { ok: false, kind: "network_error" };
  }

  const body = await parseJsonBody(response);

  if (!response.ok) {
    return { ok: false, kind: classifyErrorResponse(response.status, body) };
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).conversationId !== "string"
  ) {
    return { ok: false, kind: "malformed_response" };
  }

  return {
    ok: true,
    data: { conversationId: (body as Record<string, unknown>).conversationId as string },
  };
}

export async function sendMessage(
  conversationId: string,
  content: string,
  publicChatbotIdentifier: string
): Promise<ApiResult<{ answer: string }>> {
  let response: Response;

  try {
    response = await fetch(`/api/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, publicChatbotIdentifier }),
    });
  } catch {
    return { ok: false, kind: "network_error" };
  }

  const body = await parseJsonBody(response);

  if (!response.ok) {
    return { ok: false, kind: classifyErrorResponse(response.status, body) };
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).answer !== "string"
  ) {
    return { ok: false, kind: "malformed_response" };
  }

  return { ok: true, data: { answer: (body as Record<string, unknown>).answer as string } };
}
