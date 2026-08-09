"use client";

import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";

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

// Bounded Markdown presentation correction (pre-portfolio fix). Assistant
// responses commonly contain Markdown (bold section labels, bullet lists)
// that the model produces naturally; ARIK's chat surfaces previously
// rendered this as literal text (raw ** and - characters visible), since
// React's default `{content}` interpolation never parses it. This is a
// presentation-only change -- it does not touch retrieval, generation, or
// what content is produced, only how assistant messages are displayed.
//
// Security posture, deliberately narrow: only a fixed, safe subset of
// elements is allowed -- paragraphs, bold, italic, lists/list items, and
// inline code. Links and images are intentionally excluded entirely
// (unwrapped to their text, or dropped) rather than rendered, since this is
// a support-answer surface, not a rich-content renderer. Raw HTML embedded
// in Markdown is never parsed into real DOM (`skipHtml`, and no `rehype-raw`
// plugin is installed or referenced anywhere), so an assistant response
// containing HTML/script-like text can never execute -- it is inert text.
// This allow-list applies to assistant messages only; visitor/user messages
// are never passed through this component (see the render branch below),
// so a visitor's own message can never be interpreted as Markdown or HTML.
const ALLOWED_MARKDOWN_ELEMENTS = ["p", "strong", "em", "ul", "ol", "li", "code", "br"];

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-xs">{children}</code>
  ),
};

// Assistant-only Markdown renderer. Never used for visitor messages --
// keeping this a distinct component (rather than a conditional inside the
// shared bubble) makes that split structurally visible, not just a
// runtime branch.
function AssistantMessageContent({ content }: { content: string }) {
  return (
    <Markdown
      allowedElements={ALLOWED_MARKDOWN_ELEMENTS}
      unwrapDisallowed
      skipHtml
      components={markdownComponents}
    >
      {content}
    </Markdown>
  );
}

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
            {message.role === "visitor" ? (
              <p className="max-w-[85%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">
                {message.content}
              </p>
            ) : (
              <div className="max-w-[85%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900">
                <AssistantMessageContent content={message.content} />
              </div>
            )}
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
