"use client";

import { useEffect, useRef } from "react";

export type ChatMessage = {
  id: string;
  role: "visitor" | "assistant";
  content: string;
};

type ChatPanelProps = {
  id: string;
  chatbotName: string;
  welcomeMessage: string | null;
  messages: ChatMessage[];
  composerValue: string;
  onComposerChange: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: () => void;
  pending: boolean;
  errorMessage: string | null;
  composerRef: React.RefObject<HTMLTextAreaElement>;
};

const ERROR_ID = "widget-composer-error";

// Chat panel: message log, welcome message, and composer (Phase 7,
// Increment 3, Task 4A). A consumer of already-delivered state only --
// it owns no networking, no conversation/session identifiers, and no
// persistence; all of that lives in widget-app.tsx per this slice's
// Boundary (Task 4A owns presentation, not orchestration).
export function ChatPanel({
  id,
  chatbotName,
  welcomeMessage,
  messages,
  composerValue,
  onComposerChange,
  onSubmit,
  pending,
  errorMessage,
  composerRef,
}: ChatPanelProps) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  }, [messages.length, pending]);

  const trimmedComposerValue = composerValue.trim();
  const canSubmit = trimmedComposerValue.length > 0 && !pending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) {
      onSubmit();
    }
  }

  return (
    <section
      id={id}
      aria-label={`${chatbotName} chat`}
      className="flex h-full w-full flex-col bg-white"
    >
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="flex-1 space-y-2 overflow-y-auto p-3"
      >
        {welcomeMessage ? (
          <div className="flex flex-col items-start">
            <span className="text-xs font-medium text-gray-500">{chatbotName}</span>
            <p className="max-w-[85%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900">
              {welcomeMessage}
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex flex-col ${message.role === "visitor" ? "items-end" : "items-start"}`}
          >
            <span className="text-xs font-medium text-gray-500">
              {message.role === "visitor" ? "You" : chatbotName}
            </span>
            <p
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                message.role === "visitor" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
              }`}
            >
              {message.content}
            </p>
          </div>
        ))}

        {pending ? (
          <div className="flex flex-col items-start">
            <span className="text-xs font-medium text-gray-500">{chatbotName}</span>
            <p className="max-w-[85%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-500">
              Sending…
            </p>
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <p id={ERROR_ID} role="alert" className="px-3 pb-1 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t p-3">
        <label htmlFor="widget-message-input" className="sr-only">
          Message
        </label>
        <textarea
          id="widget-message-input"
          ref={composerRef}
          value={composerValue}
          onChange={(event) => onComposerChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit) {
                onSubmit();
              }
            }
          }}
          aria-describedby={errorMessage ? ERROR_ID : undefined}
          rows={1}
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          placeholder="Type a message"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Send
        </button>
      </form>
    </section>
  );
}
