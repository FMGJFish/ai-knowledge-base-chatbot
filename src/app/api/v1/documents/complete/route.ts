import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { confirmDocumentIntake } from "@/lib/services/knowledge-processing/intake";

// Documents upload-completion Route Handler (Phase 4, Increment 1
// revision). Independently re-authenticates and re-authorizes — this
// request never inherits authorization from the upload-authorization
// request (Phase 3 boundary). Boundary validation only; every
// continuity/policy decision belongs to the Knowledge Processing Service.
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

  const { uploadIntentToken } = body as Record<string, unknown>;

  if (typeof uploadIntentToken !== "string" || uploadIntentToken.length === 0) {
    return NextResponse.json({ error: "uploadIntentToken is required" }, { status: 400 });
  }

  const result = await confirmDocumentIntake(uploadIntentToken);

  if (!result.accepted) {
    const status =
      result.reason === "object_not_found"
        ? 404
        : result.reason === "size_exceeds_policy"
          ? 413
          : result.reason === "expired_token"
            ? 410
            : 422;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ document: result.document }, { status: 201 });
}
