import { WidgetApp } from "./widget-app";
import { WidgetUnavailable } from "./widget-unavailable";

type WidgetPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Public Chat Widget route (Phase 7, Increment 3, Task 4A). Reserved as
// the sole frameable route by next.config.mjs's frame-embedding policy
// (Task 3, AD-026). A missing Public Chatbot Identifier is rejected here,
// server-side, before any client code mounts or any endpoint is called;
// an identifier that is present but malformed or unresolvable is instead
// discovered by the client's own Widget Configuration request and
// presents identically (see widget-app.tsx, widget-unavailable.tsx).
export default async function WidgetPage({ searchParams }: WidgetPageProps) {
  const params = await searchParams;
  const rawIdentifier = params.publicChatbotIdentifier;
  const publicChatbotIdentifier = typeof rawIdentifier === "string" ? rawIdentifier : undefined;

  if (!publicChatbotIdentifier) {
    return <WidgetUnavailable />;
  }

  return <WidgetApp publicChatbotIdentifier={publicChatbotIdentifier} />;
}
