import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

// Knowledge Processing Service — Document read operations (Phase 4,
// Increment 2). Documents are owned by the Knowledge Processing Service;
// Route Handlers delegate every read here rather than querying the
// `documents` table directly, preserving the same ownership boundary for
// reads that Increment 1 established for writes.
//
// Only fields with clear administrative business meaning are returned —
// `storage_reference` (an internal, generated Storage object key) is
// deliberately withheld from both the list and detail results below; it
// has no admin-facing meaning yet and is not exposed merely because the
// column exists.
export interface DocumentSummary {
  id: string;
  filename: string;
  status: string;
  uploadedAt: string;
}

// Ordered by most recently uploaded first — the minimum deterministic
// ordering the existing Document data supports, chosen so an administrator
// sees new uploads first without introducing pagination, filtering, or
// sorting controls beyond the approved Increment 2 scope.
export async function listDocuments(): Promise<DocumentSummary[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("documents")
    .select("id, filename, status, uploaded_at")
    .order("uploaded_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list documents: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    filename: row.filename,
    status: row.status,
    uploadedAt: row.uploaded_at,
  }));
}

export type DocumentDetailResult = { found: true; document: DocumentSummary } | { found: false };

export async function getDocumentById(id: string): Promise<DocumentDetailResult> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("documents")
    .select("id, filename, status, uploaded_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to retrieve document: ${error.message}`);
  }

  if (!data) {
    return { found: false };
  }

  return {
    found: true,
    document: {
      id: data.id,
      filename: data.filename,
      status: data.status,
      uploadedAt: data.uploaded_at,
    },
  };
}
