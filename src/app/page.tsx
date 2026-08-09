const publicChatbotIdentifier = process.env.NEXT_PUBLIC_CHATBOT_IDENTIFIER;

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6 py-24 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-brand-700">ARIK</h1>
        <p className="mt-2 text-sm text-gray-500">
          AI Knowledge Base & Customer Support Platform
        </p>
      </div>

      <p className="max-w-xl text-base text-gray-700">
        Turn your existing business content into a conversational support experience. ARIK
        retrieves relevant information from your knowledge base and uses it to answer customer
        questions naturally.
      </p>

      <div className="grid w-full max-w-3xl gap-6 text-left sm:grid-cols-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Ask naturally</h2>
          <p className="mt-1 text-sm text-gray-600">
            ARIK handles conversational questions and follow-ups—not just exact keyword matches.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Grounded in your content</h2>
          <p className="mt-1 text-sm text-gray-600">
            Responses are based on your knowledge base, with honest fallbacks when the available
            information isn&apos;t enough.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Built around your knowledge</h2>
          <p className="mt-1 text-sm text-gray-600">
            Upload and process PDF knowledge sources, then use that content to power
            customer-facing conversations.
          </p>
        </div>
      </div>

      {publicChatbotIdentifier ? (
        <a
          href={`/widget?publicChatbotIdentifier=${publicChatbotIdentifier}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-brand-600 px-6 py-3 text-sm font-medium text-white"
        >
          Try the Live Demo
        </a>
      ) : (
        <span
          aria-disabled="true"
          className="rounded-lg bg-gray-300 px-6 py-3 text-sm font-medium text-gray-600"
        >
          Live Demo Unavailable
        </span>
      )}

      <p className="max-w-xl text-xs text-gray-500">
        Built with Next.js, Supabase, and OpenAI using retrieval-augmented generation and grounded
        AI responses.
      </p>
    </main>
  );
}
