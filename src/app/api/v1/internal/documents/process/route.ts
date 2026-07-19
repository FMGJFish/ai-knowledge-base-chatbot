import { NextResponse } from "next/server";
import {
  INTERNAL_SERVICE_SECRET_HEADER,
  verifyInternalServiceRequest,
} from "@/lib/services/knowledge-processing/internal-auth";
import { processDocument } from "@/lib/services/knowledge-processing/processing";

// Internal asynchronous processing trigger (Phase 4, Increment 3). Not a
// public API resource -- authenticated by a shared internal secret, never
// by administrator session, and never called from the browser. This is the
// second stage of the approved trigger architecture:
// confirmDocumentIntake() -> after() -> this Route Handler -> Knowledge
// Processing Service. Runs as its own, independent serverless invocation
// (its own maxDuration budget), which is the reason this is a separate
// Route Handler rather than work done inline inside after() itself.
//
// No maxDuration override is set here: an earlier attempt to set one
// (300s) was an unverified guess -- not this deployment's actual platform
// default, not a confirmed capability of this account's plan, and not a
// repository policy. Removed per CSA review rather than replaced with a
// different guess. This route currently runs under whatever this
// deployment's true platform default is, which has not yet been confirmed.
// Set an explicit value only once real evidence (embedding latency,
// confirmed plan ceiling) justifies a specific number.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const providedSecret = request.headers.get(INTERNAL_SERVICE_SECRET_HEADER);

  if (!verifyInternalServiceRequest(providedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let documentId: string;

  try {
    const body = await request.json();

    if (typeof body?.documentId !== "string" || body.documentId.length === 0) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    documentId = body.documentId;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await processDocument(documentId);

  return NextResponse.json(result, { status: 200 });
}
