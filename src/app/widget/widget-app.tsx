"use client";

import { useEffect, useRef, useState } from "react";
import {
  createConversation,
  fetchWidgetConfig,
  sendMessage,
  type ApiErrorKind,
} from "@/lib/widget-client/api";
import {
  COLLAPSED_DIMENSIONS,
  EXPANDED_DIMENSIONS,
  postInitFailure,
  postReady,
  postResizeRequired,
  postStateChanged,
  postTeardown,
} from "@/lib/widget-client/parent-channel";
import { runConversationContinuationLifecycle } from "@/lib/widget-client/message-lifecycle";
import { createWidgetStorage } from "@/lib/widget-client/storage";
import { ChatPanel, type ChatMessage } from "./chat-panel";
import { WidgetUnavailable } from "./widget-unavailable";

type ConfigStatus = "loading" | "ready" | "degraded" | "unavailable";

function describeError(kind: ApiErrorKind): string {
  switch (kind) {
    case "rate_limited":
      return "Too many messages right now. Please wait a moment and try again.";
    case "invalid_identifier":
      return "This chat widget is not configured correctly.";
    case "network_error":
      return "Could not reach the chat service. Check your connection and try again.";
    case "conversation_expired":
    case "malformed_response":
    case "unknown_error":
    default:
      return "Something went wrong. Please try again.";
  }
}

type WidgetAppProps = {
  publicChatbotIdentifier: string;
};

// Top-level orchestrator for the Public Chat Widget (Phase 7, Increment
// 3): floating launcher, config loading, lazy conversation creation
// (AD-021), multi-turn message exchange, and -- as of Task 4C --
// cross-reload continuity via the storage abstraction (AD-022,
// AD-029). No localStorage access happens directly in this file; all
// storage mechanics are owned by src/lib/widget-client/storage.ts. This
// component only decides *when* persisted values are hydrated,
// persisted, cleared, or replaced.
export function WidgetApp({ publicChatbotIdentifier }: WidgetAppProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [configStatus, setConfigStatus] = useState<ConfigStatus>("loading");
  const [chatbotName, setChatbotName] = useState<string | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);

  // One storage controller for this mounted widget instance. Reading it
  // synchronously up front (no network involved) is what makes
  // restoration possible without ever issuing a network call on mount --
  // preserving AD-021's lazy-creation timing exactly.
  const [storage] = useState(() => createWidgetStorage(publicChatbotIdentifier));
  const [restored] = useState(() => storage.load());

  // Reused across reloads when storage is available (ADR Decision 006);
  // generated fresh, and persisted, when no valid cached value exists
  // (first-ever visit, or storage was unavailable so nothing was ever
  // persisted). Never cleared or regenerated when a conversation expires
  // -- only conversationId/transcript are cleared in that case.
  const [visitorSessionId] = useState<string>(() => {
    if (restored.visitorSessionId) {
      return restored.visitorSessionId;
    }

    const generated = crypto.randomUUID();
    storage.persistVisitorSessionId(generated);
    return generated;
  });

  // conversationId/messages are restored as unconfirmed, presentational
  // values only (AD-022) -- restoring them here asserts nothing about
  // whether the server-side conversation is still active. Validity is
  // determined solely by the server, and only when the visitor next
  // intentionally sends a message.
  const [conversationId, setConversationId] = useState<string | null>(restored.conversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(restored.transcript);
  const [composerValue, setComposerValue] = useState("");
  const [pending, setPending] = useState(false);
  const [sendErrorMessage, setSendErrorMessage] = useState<string | null>(null);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const wasOpenRef = useRef(false);

  // Synchronous re-entrancy guard: prevents a second send/recovery
  // lifecycle from starting while one is unresolved, independent of
  // `pending`'s React-state update timing.
  const sendLifecycleActiveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    fetchWidgetConfig(publicChatbotIdentifier).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        if (result.kind === "invalid_identifier") {
          setConfigStatus("unavailable");
          postInitFailure("invalid_identifier");
        } else {
          setConfigStatus("degraded");
          setSendErrorMessage(
            "This chat could not load its configuration. You can still try sending a message."
          );
        }
        return;
      }

      setChatbotName(result.data.name);
      setWelcomeMessage(result.data.welcomeMessage);
      setConfigStatus("ready");
    });

    return () => {
      cancelled = true;
    };
  }, [publicChatbotIdentifier]);

  useEffect(() => {
    if (isOpen) {
      composerRef.current?.focus();
    } else if (wasOpenRef.current) {
      launcherRef.current?.focus();
    }

    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // Parent-widget protocol (Task 4B, AD-027): announce readiness once,
  // and notify on teardown (pagehide fires reliably when this iframe is
  // removed or navigated away from, regardless of how the host page
  // removes it). Unaffected by Task 4C.
  useEffect(() => {
    postReady();

    window.addEventListener("pagehide", postTeardown);

    return () => {
      window.removeEventListener("pagehide", postTeardown);
      postTeardown();
    };
  }, []);

  // Every open/close toggle is both a presentation-state change and a
  // required container-size change (AD-025); the two message categories
  // stay separate on the wire even though this app always emits them
  // together. Unaffected by Task 4C.
  useEffect(() => {
    postStateChanged(isOpen ? "open" : "closed");
    postResizeRequired(isOpen ? EXPANDED_DIMENSIONS : COLLAPSED_DIMENSIONS);
  }, [isOpen]);

  if (configStatus === "unavailable") {
    return <WidgetUnavailable />;
  }

  function updateConversationId(id: string | null) {
    setConversationId(id);
    storage.persistConversationId(id);
  }

  // Clears only the stale conversation/transcript state -- visitorSessionId
  // is deliberately untouched, per AD-029 and this slice's acceptance
  // criteria that the visitor session identifier survives a
  // stale-conversation clear.
  function clearStaleConversationState() {
    setConversationId(null);
    setMessages([]);
    storage.clearConversationState();
  }

  // Takes an explicit transcript base rather than reading the `messages`
  // state variable from closure: within a single handleSend invocation,
  // setMessages([]) (via clearStaleConversationState) does not update
  // `messages` until the next render, so appending against the closure
  // value would silently resurrect the pre-expiry transcript after a
  // recovery. Threading the base explicitly avoids that stale-closure
  // hazard.
  function appendExchange(
    base: ChatMessage[],
    visitorContent: string,
    assistantContent: string
  ): ChatMessage[] {
    const next: ChatMessage[] = [
      ...base,
      { id: crypto.randomUUID(), role: "visitor", content: visitorContent },
      { id: crypto.randomUUID(), role: "assistant", content: assistantContent },
    ];
    setMessages(next);
    storage.persistTranscript(next);
    return next;
  }

  // Bounded send/recovery lifecycle (Section 3.A of the approved Task 4C
  // specification). For one intentional visitor submission, at most
  // three network requests occur: the initial message send; if and only
  // if that is rejected as missing-or-expired, one replacement-
  // conversation creation; and one resubmission of the exact original
  // pending message. No second replacement creation, no second
  // resubmission, and no repeated recovery cycle occurs under any
  // circumstance -- a failure at the replacement-creation or
  // resubmission step is routed through the same terminal-error
  // presentation as any other send failure.
  async function handleSend() {
    const pendingContent = composerValue.trim();

    if (!pendingContent || pending || sendLifecycleActiveRef.current) {
      return;
    }

    sendLifecycleActiveRef.current = true;
    setPending(true);
    setSendErrorMessage(null);

    try {
      const priorConversationId = conversationId;

      if (!priorConversationId) {
        // AD-021 lazy creation, unchanged from Task 4A: no cached
        // conversation to attempt continuation against.
        const createResult = await createConversation(visitorSessionId, publicChatbotIdentifier);

        if (!createResult.ok) {
          setSendErrorMessage(describeError(createResult.kind));
          return;
        }

        updateConversationId(createResult.data.conversationId);

        const sendResult = await sendMessage(
          createResult.data.conversationId,
          pendingContent,
          publicChatbotIdentifier
        );

        if (!sendResult.ok) {
          setSendErrorMessage(describeError(sendResult.kind));
          return;
        }

        appendExchange(messages, pendingContent, sendResult.data.answer);
        setComposerValue("");
        return;
      }

      // Attempt continuation using the (possibly restored) cached
      // conversation id via the extracted, independently-verified
      // production lifecycle (src/lib/widget-client/message-lifecycle.ts).
      // The server is the sole authority on whether it is still valid --
      // this is an attempt, not an assertion. onStaleConversationDetected
      // clears stale state (visitorSessionId preserved) exactly once, no
      // later than the point the rejection is recognized.
      const lifecycleResult = await runConversationContinuationLifecycle(
        {
          conversationId: priorConversationId,
          visitorSessionId,
          publicChatbotIdentifier,
          content: pendingContent,
        },
        {
          sendMessage,
          createConversation,
          onStaleConversationDetected: clearStaleConversationState,
        }
      );

      if (!lifecycleResult.ok) {
        // A replacement conversation may have been created server-side
        // even though this attempt still fails (resubmission failed
        // after a successful replacement creation). Persist it before
        // presenting the error so the next intentional retry continues
        // against it instead of creating another conversation
        // unnecessarily. No exchange is appended, the composer is left
        // untouched (preserving the visitor's pending text), and no
        // automatic retry occurs.
        if (lifecycleResult.recoveredConversationId) {
          updateConversationId(lifecycleResult.recoveredConversationId);
        }
        setSendErrorMessage(describeError(lifecycleResult.kind));
        return;
      }

      updateConversationId(lifecycleResult.conversationId);

      // recovered=true means the initial conversationId was rejected --
      // build the transcript from an explicit empty base (never the
      // `messages` closure, which would still hold the pre-expiry
      // transcript) so stale history cannot be resurrected.
      appendExchange(
        lifecycleResult.recovered ? [] : messages,
        pendingContent,
        lifecycleResult.answer
      );
      setComposerValue("");
    } finally {
      setPending(false);
      sendLifecycleActiveRef.current = false;
    }
  }

  return (
    <div className="relative min-h-screen">
      <button
        ref={launcherRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls="widget-chat-panel"
        onClick={() => setIsOpen((open) => !open)}
        className="fixed bottom-4 right-4 rounded-full bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-800"
      >
        {isOpen ? "Close chat" : "Open chat"}
      </button>

      <div
        id="widget-chat-panel"
        hidden={!isOpen}
        className="fixed bottom-20 right-4 h-[28rem] w-80 overflow-hidden rounded-lg border border-gray-200 shadow-xl"
      >
        {configStatus === "loading" ? (
          <div role="status" aria-live="polite" className="p-4 text-sm text-gray-500">
            Loading…
          </div>
        ) : (
          <ChatPanel
            id="widget-chat-panel-content"
            chatbotName={chatbotName ?? "Assistant"}
            welcomeMessage={welcomeMessage}
            messages={messages}
            composerValue={composerValue}
            onComposerChange={setComposerValue}
            onSubmit={handleSend}
            pending={pending}
            errorMessage={sendErrorMessage}
            composerRef={composerRef}
          />
        )}
      </div>
    </div>
  );
}
