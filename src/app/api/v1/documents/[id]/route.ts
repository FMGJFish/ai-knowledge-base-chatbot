import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { getDocumentById } from "@/lib/services/knowledge-processing/documents-query";

// Document detail/status Route Handler (Phase 4, Increment 2). Boundary
// validation only — the identifier's shape (is it a UUID) is checked here;
// whether a Document with that identifier actually exists, and the
// resulting not-found determination, belong exclusively to the Knowledge
// Processing Service. This handler never queries the `documents` table
// directly.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid document identifier" }, { status: 400 });
  }

  const result = await getDocumentById(id);

  if (!result.found) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json({ document: result.document });
}
