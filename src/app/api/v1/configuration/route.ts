import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { createServiceClient } from "@/lib/supabase/server";

// Chatbot Configuration Route Handler (Phase 8, Increment 2). Boundary
// validation and persistence only, per ADR Decision 008 -- no dedicated
// Configuration Service module. `similarity_threshold` and `top_k` are
// never read or written here (AD-033): this resource covers exactly
// name, welcomeMessage, and instructions. The singleton row (id = true)
// always exists (seeded at Phase 2); this handler never inserts.

const NAME_MAX_LENGTH = 100;
const WELCOME_MESSAGE_MAX_LENGTH = 500;
const INSTRUCTIONS_MAX_LENGTH = 4000;

interface ConfigurationResponse {
  name: string;
  welcomeMessage: string | null;
  instructions: string | null;
}

export async function GET() {
  const user = await getAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("chatbot_configuration")
    .select("name, welcome_message, instructions")
    .eq("id", true)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "configuration_unavailable" }, { status: 500 });
  }

  const response: ConfigurationResponse = {
    name: data.name,
    welcomeMessage: data.welcome_message,
    instructions: data.instructions,
  };

  return NextResponse.json(response, { status: 200 });
}

export async function PUT(request: Request) {
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

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // PUT is a full-resource replacement (Delegation Package, HTTP Verb
  // Choice rationale): every field must be structurally present as the
  // body's own property. A missing property is a distinct failure from
  // an explicit `null` -- omission must never be silently interpreted as
  // "no change" or coerced to null, which would reintroduce partial
  // -update (PATCH) semantics this resource does not support.
  const REQUIRED_PROPERTIES = ["name", "welcomeMessage", "instructions"] as const;

  for (const property of REQUIRED_PROPERTIES) {
    if (!Object.prototype.hasOwnProperty.call(body, property)) {
      return NextResponse.json({ error: `${property} is required` }, { status: 400 });
    }
  }

  const { name, welcomeMessage, instructions } = body as Record<string, unknown>;

  if (typeof name !== "string") {
    return NextResponse.json({ error: "name must be a string" }, { status: 400 });
  }

  const trimmedName = name.trim();

  if (trimmedName.length < 1 || trimmedName.length > NAME_MAX_LENGTH) {
    return NextResponse.json(
      { error: `name must be between 1 and ${NAME_MAX_LENGTH} characters` },
      { status: 422 }
    );
  }

  if (welcomeMessage !== null && typeof welcomeMessage !== "string") {
    return NextResponse.json({ error: "welcomeMessage must be a string or null" }, { status: 400 });
  }

  if (typeof welcomeMessage === "string" && welcomeMessage.length > WELCOME_MESSAGE_MAX_LENGTH) {
    return NextResponse.json(
      { error: `welcomeMessage must be at most ${WELCOME_MESSAGE_MAX_LENGTH} characters` },
      { status: 422 }
    );
  }

  if (instructions !== null && typeof instructions !== "string") {
    return NextResponse.json({ error: "instructions must be a string or null" }, { status: 400 });
  }

  if (typeof instructions === "string" && instructions.length > INSTRUCTIONS_MAX_LENGTH) {
    return NextResponse.json(
      { error: `instructions must be at most ${INSTRUCTIONS_MAX_LENGTH} characters` },
      { status: 422 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("chatbot_configuration")
    .update({
      name: trimmedName,
      welcome_message: welcomeMessage,
      instructions: instructions,
    })
    .eq("id", true)
    .select("name, welcome_message, instructions")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  const response: ConfigurationResponse = {
    name: data.name,
    welcomeMessage: data.welcome_message,
    instructions: data.instructions,
  };

  return NextResponse.json(response, { status: 200 });
}
