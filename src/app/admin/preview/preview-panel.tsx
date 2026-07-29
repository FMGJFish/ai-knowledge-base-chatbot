"use client";

import { useEffect, useRef, useState } from "react";
import { ChatPanel, type ChatMessage } from "@/app/widget/chat-panel";

type Configuration = {
  name: string;
  welcomeMessage: string | null;
};

type PreviewResponse = {
  answer: string;
  chunks: unknown[];
};

// Admin Test/Preview orchestrator (Phase 8, Increment 3). Reuses `ChatPanel`
// unmodified; this component supplies its own presentation-oriented prop
// contract, independent of widget-app.tsx's orchestration -- no client-side
// storage, no cross-reload session continuity, and no parent-frame
// messaging are reproduced here (Delegation Package, Section 12). Every
// exchange is appended to a purely in-memory list for display only; no
// history is ever sent back to the server (Section 7, AD-035). Refreshing
// this page clears the preview session by construction -- nothing is
// persisted anywhere on the client.
export function PreviewPanel() {
  const [chatbotName, setChatbotName] = useState<string | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadConfiguration() {
      try {
        const response = await fetch("/api/v1/configuration");

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setConfigError(`Failed to load chatbot configuration (status ${response.status}).`);
          return;
        }

        const data = (await response.json()) as Configuration;

        if (!cancelled) {
          setChatbotName(data.name);
          setWelcomeMessage(data.welcomeMessage);
        }
      } catch {
        // Covers both network failures (fetch() rejects) and response-body
        // failures (malformed/non-JSON body, unexpected shape) -- either
        // way the component must still reach a completed state rather than
        // remain on "Loading preview..." indefinitely (F-01).
        if (!cancelled) {
          setConfigError("Failed to load chatbot configuration.");
        }
      } finally {
        if (!cancelled) {
          setConfigLoaded(true);
        }
      }
    }

    loadConfiguration();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSend() {
    const trimmed = composerValue.trim();

    if (!trimmed || pending) {
      return;
    }

    setPending(true);
    setSendError(null);

    try {
      const response = await fetch("/api/v1/admin/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setSendError(body?.error ?? `Request failed (status ${response.status}).`);
        return;
      }

      const data = (await response.json()) as PreviewResponse;

      setMessages((previous) => [
        ...previous,
        { id: crypto.randomUUID(), role: "visitor", content: trimmed },
        { id: crypto.randomUUID(), role: "assistant", content: data.answer },
      ]);
      setComposerValue("");
    } catch {
      setSendError("Request failed.");
    } finally {
      setPending(false);
    }
  }

  if (!configLoaded) {
    return <p>Loading preview…</p>;
  }

  return (
    <div className="flex max-w-xl flex-col gap-2">
      {configError ? (
        <p role="alert" className="text-sm text-red-700">
          {configError}
        </p>
      ) : null}

      <div className="h-[28rem] overflow-hidden rounded-lg border border-gray-200">
        <ChatPanel
          id="admin-preview-panel"
          chatbotName={chatbotName ?? "Assistant"}
          welcomeMessage={welcomeMessage}
          messages={messages}
          composerValue={composerValue}
          onComposerChange={setComposerValue}
          onSubmit={handleSend}
          pending={pending}
          errorMessage={sendError}
          composerRef={composerRef}
        />
      </div>
    </div>
  );
}
