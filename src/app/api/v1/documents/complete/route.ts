import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { confirmDocumentIntake } from "@/lib/services/knowledge-processing/intake";

// Documents upload-completion Route Handler (Phase 4, Increment 1
// revision). Independently re-authenticates and re-authorizes — this
// request never inherits authorization from the upload-authorization
// request (Phase 3 boundary). Boundary validation only; every
// continuity/policy decision belongs to the Knowledge Processing Service.
//
// confirmDocumentIntake() schedules the Increment 3 asynchronous
// processing trigger via after(), which runs within this route's own
// maxDuration budget (extended past the response via the platform's
// waitUntil). No maxDuration override is set here: an earlier attempt to
// set one (300s) was an unverified guess -- not this deployment's actual
// platform default, not a confirmed capability of this account's plan, and
// not a repository policy. Removed per CSA review rather than replaced
// with a different guess. This route currently runs under whatever this
// deployment's true platform default is, which has not yet been confirmed.
// Set an explicit value only once real evidence (embedding latency,
// confirmed plan ceiling) justifies a specific number.

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
