import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { authorizeDocumentIntake } from "@/lib/services/knowledge-processing/intake";

// Documents upload-authorization Route Handler (Phase 4, Increment 1
// revision). Boundary validation only — structural request-contract shape.
// Every document-intake policy decision (accepted content type, the 25 MB
// maximum, filename policy) belongs exclusively to the Knowledge Processing
// Service. Raw PDF bytes never transit this handler — the browser transfers
// them directly to Supabase Storage under the authorization this endpoint
// returns.
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

  const { filename, contentType, declaredSize } = body as Record<string, unknown>;

  if (
    typeof filename !== "string" ||
    typeof contentType !== "string" ||
    typeof declaredSize !== "number" ||
    !Number.isFinite(declaredSize) ||
    !Number.isInteger(declaredSize) ||
    declaredSize <= 0
  ) {
    return NextResponse.json(
      { error: "filename, contentType, and declaredSize are required" },
      { status: 400 }
    );
  }

  const result = await authorizeDocumentIntake({ filename, contentType, declaredSize });

  if (!result.accepted) {
    const status = result.reason === "size_exceeds_policy" ? 413 : 422;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json(
    {
      storagePath: result.storagePath,
      supabaseUpload: result.supabaseUpload,
      uploadIntentToken: result.uploadIntentToken,
    },
    { status: 201 }
  );
}
