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
// 3, Task 4A): floating launcher, config loading, lazy conversation
// creation (AD-021), and multi-turn message exchange -- all scoped to a
// single page load. No localStorage, no parent-page communication, no
// expiry re-establishment: those remain Task 4B/4C/4D per this slice's
// Boundary and Non-Goals.
export function WidgetApp({ publicChatbotIdentifier }: WidgetAppProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [configStatus, setConfigStatus] = useState<ConfigStatus>("loading");
  const [chatbotName, setChatbotName] = useState<string | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);

  // Ephemeral, in-memory-only for this slice (AD-021 scope note): a page
  // reload generates a new value. Persisting it across reloads is Task
  // 4C's responsibility (AD-022/AD-029), not this slice's.
  const [visitorSessionId] = useState(() => crypto.randomUUID());
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [pending, setPending] = useState(false);
  const [sendErrorMessage, setSendErrorMessage] = useState<string | null>(null);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const wasOpenRef = useRef(false);

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
  // removes it).
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
  // together.
  useEffect(() => {
    postStateChanged(isOpen ? "open" : "closed");
    postResizeRequired(isOpen ? EXPANDED_DIMENSIONS : COLLAPSED_DIMENSIONS);
  }, [isOpen]);

  if (configStatus === "unavailable") {
    return <WidgetUnavailable />;
  }

  async function handleSend() {
    const content = composerValue.trim();

    if (!content || pending) {
      return;
    }

    setPending(true);
    setSendErrorMessage(null);

    let activeConversationId = conversationId;

    if (!activeConversationId) {
      const createResult = await createConversation(visitorSessionId, publicChatbotIdentifier);

      if (!createResult.ok) {
        setPending(false);
        setSendErrorMessage(describeError(createResult.kind));
        return;
      }

      activeConversationId = createResult.data.conversationId;
      setConversationId(activeConversationId);
    }

    const sendResult = await sendMessage(activeConversationId, content, publicChatbotIdentifier);

    setPending(false);

    if (!sendResult.ok) {
      setSendErrorMessage(describeError(sendResult.kind));
      return;
    }

    setMessages((previous) => [
      ...previous,
      { id: crypto.randomUUID(), role: "visitor", content },
      { id: crypto.randomUUID(), role: "assistant", content: sendResult.data.answer },
    ]);
    setComposerValue("");
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
