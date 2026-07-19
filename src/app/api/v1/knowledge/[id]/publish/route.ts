import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { publishDocument } from "@/lib/services/knowledge-processing/publishing";

// Knowledge Management API resource -- publish action (Phase 4,
// Increment 4). A distinct resource from Documents, per 04_api_design_v1.md
// ("document submission and knowledge availability are related but
// distinct administrative capabilities"). Boundary validation only --
// identifier shape is checked here; the Knowledge Processing Service owns
// the ready_for_review -> published transition, its state guard, and
// idempotent-publish behavior. This handler never queries the `documents`
// table directly.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid document identifier" }, { status: 400 });
  }

  const result = await publishDocument(id);

  if (result.outcome === "not_found") {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (result.outcome === "invalid_state") {
    return NextResponse.json(
      { error: "document_not_ready_for_review", currentStatus: result.currentStatus },
      { status: 422 }
    );
  }

  return NextResponse.json(
    { document: result.document, alreadyPublished: result.outcome === "already_published" },
    { status: 200 }
  );
}
