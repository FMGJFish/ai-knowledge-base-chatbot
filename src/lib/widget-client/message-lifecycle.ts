import type { ApiErrorKind, ApiResult } from "./api";

// Bounded send/recovery orchestration for a message sent against an
// already-established (possibly restored) conversation (Phase 7,
// Increment 3, Task 4C, Section 3.A of the approved Execution Slice
// Specification; AD-029). Extracted from widget-app.tsx so the
// orchestration itself is independently, deterministically verifiable
// (scripts/verify-message-lifecycle.ts) without a browser or a React
// testing framework.
//
// This module owns only the asynchronous control flow: the initial send
// attempt, recognizing the typed "conversation_expired" result, invoking
// a caller-supplied stale-state-clear callback exactly once, performing
// exactly one replacement-conversation creation, performing exactly one
// resubmission of the exact original pending content, and producing a
// terminal success or failure result. There is no recursion and no
// repeated recovery -- the function returns after at most one recovery
// attempt, by construction, not merely by a runtime guard.
//
// This module does not own React state, localStorage, presentation,
// composer state, parent-channel behavior, server authority, or API
// response classification -- classification already happened inside
// api.ts's sendMessage/createConversation, which this module only
// consumes via injected dependencies. It is not a new architectural
// service: it has no independent lifecycle, holds no state of its own
// between calls, and is invoked synchronously within widget-app.tsx's
// existing handleSend flow exactly where the inline logic previously
// lived.

// eslint-disable no-unused-vars for the method parameter names below:
// they exist solely to document this contract and are not bindings the
// base (non-type-aware) no-unused-vars rule can recognize as
// declarations rather than usages (same rationale as storage.ts's
// WidgetStorage interface).
/* eslint-disable no-unused-vars */
export interface MessageLifecycleDeps {
  sendMessage(
    conversationId: string,
    content: string,
    publicChatbotIdentifier: string
  ): Promise<ApiResult<{ answer: string }>>;
  createConversation(
    visitorSessionId: string,
    publicChatbotIdentifier: string
  ): Promise<ApiResult<{ conversationId: string }>>;
  // Called exactly once, and only if the initial send is rejected as
  // conversation_expired -- before the replacement-creation attempt.
  // Callers use this to clear their own stale conversation/transcript
  // state (React state and storage); this module holds no such state
  // itself.
  onStaleConversationDetected(): void;
}
/* eslint-enable no-unused-vars */

export type MessageLifecycleParams = {
  conversationId: string;
  visitorSessionId: string;
  publicChatbotIdentifier: string;
  content: string;
};

export type MessageLifecycleResult =
  | {
      ok: true;
      conversationId: string;
      answer: string;
      // True only when the initial conversationId was rejected and a
      // replacement conversation now holds the exchange. Callers must
      // build the persisted/rendered transcript from an explicit empty
      // base in this case -- never from the pre-expiry transcript --
      // so stale history cannot be resurrected.
      recovered: boolean;
    }
  | {
      ok: false;
      kind: ApiErrorKind;
      // Required (not optional): every failure branch must state
      // whether a replacement conversation was actually created
      // server-side before this attempt still terminated in failure.
      // Non-null only when createConversation succeeded during recovery
      // but the subsequent resubmission then failed -- the one outcome
      // where a real, persisted conversation would otherwise be lost.
      // Null for an unrelated initial-send error and for a failed
      // replacement creation, in both of which no replacement
      // conversation exists to propagate. Callers must persist this id
      // (via their own updateConversationId-equivalent) before
      // presenting or returning from the error path, so the next
      // intentional retry continues against it rather than creating
      // another replacement unnecessarily.
      recoveredConversationId: string | null;
    };

export async function runConversationContinuationLifecycle(
  params: MessageLifecycleParams,
  deps: MessageLifecycleDeps
): Promise<MessageLifecycleResult> {
  const initialSend = await deps.sendMessage(
    params.conversationId,
    params.content,
    params.publicChatbotIdentifier
  );

  if (initialSend.ok) {
    return {
      ok: true,
      conversationId: params.conversationId,
      answer: initialSend.data.answer,
      recovered: false,
    };
  }

  if (initialSend.kind !== "conversation_expired") {
    return { ok: false, kind: initialSend.kind, recoveredConversationId: null };
  }

  deps.onStaleConversationDetected();

  const replacement = await deps.createConversation(
    params.visitorSessionId,
    params.publicChatbotIdentifier
  );

  if (!replacement.ok) {
    return { ok: false, kind: replacement.kind, recoveredConversationId: null };
  }

  const resubmit = await deps.sendMessage(
    replacement.data.conversationId,
    params.content,
    params.publicChatbotIdentifier
  );

  if (!resubmit.ok) {
    // Replacement creation succeeded server-side even though this
    // overall attempt still fails -- propagate its id so the caller can
    // persist it and avoid creating yet another conversation on retry.
    return {
      ok: false,
      kind: resubmit.kind,
      recoveredConversationId: replacement.data.conversationId,
    };
  }

  return {
    ok: true,
    conversationId: replacement.data.conversationId,
    answer: resubmit.data.answer,
    recovered: true,
  };
}
