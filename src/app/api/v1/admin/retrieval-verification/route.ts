import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { retrieveRelevantChunks } from "@/lib/services/retrieval/retrieve";

// Temporary Verification Interface (Phase 5, Increment 2). Admin-gated,
// internal-only invocation surface for the Retrieval Service delivered by
// Increment 1 -- not a public Retrieval API, not a production chatbot
// entry point, and not permanent testing architecture. Boundary validation
// only: this handler performs authentication, request validation,
// delegation to the Retrieval Service, and response formatting -- it
// introduces no ranking, filtering, embedding, or business logic of its
// own, and the Retrieval Service is invoked exactly once, unmodified.
export async function POST(request: Request) {
  const user = await getAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { query } = body as Record<string, unknown>;

  if (typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "A non-empty query is required" }, { status: 400 });
  }

  const chunks = await retrieveRelevantChunks(query.trim());

  return NextResponse.json({ chunks });
}
