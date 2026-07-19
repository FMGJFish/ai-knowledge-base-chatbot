import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

// Knowledge Processing Service -- Knowledge Publication (Phase 4,
// Increment 4). Implements ADR Decision 007: a Document becomes eligible
// for retrieval only after an explicit administrator publish action,
// separate from technical processing completion (Increment 3, which
// reaches `ready_for_review` only). This increment does not implement any
// Retrieval Service behavior -- it transitions status only.
export interface PublishedDocument {
  id: string;
  status: "published";
}

export type PublishDocumentResult =
  | { outcome: "published"; document: PublishedDocument }
  | { outcome: "already_published"; document: PublishedDocument }
  | { outcome: "not_found" }
  | { outcome: "invalid_state"; currentStatus: string };

// Publishes a Document, transitioning `ready_for_review` -> `published`.
//
// Idempotent by explicit Chief Systems Architect decision (Increment 4
// establishment/delegation): a request against an already-`published`
// Document succeeds, mutates no state, performs no duplicate work, and is
// distinguishable in the result from a first-time publish. This is a
// retry-safety requirement, not a convenience -- callers must not treat
// `already_published` as an error.
//
// A Document in any status other than `ready_for_review` or `published`
// (`uploaded`, `processing`, `failed`) is rejected as `invalid_state` --
// technical readiness is a precondition this service enforces, per ADR
// Decision 007.
export async function publishDocument(documentId: string): Promise<PublishDocumentResult> {
  const supabase = createServiceClient();

  const { data: document, error: fetchError } = await supabase
    .from("documents")
    .select("id, status")
    .eq("id", documentId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to retrieve document for publishing: ${fetchError.message}`);
  }

  if (!document) {
    return { outcome: "not_found" };
  }

  if (document.status === "published") {
    return { outcome: "already_published", document: { id: document.id, status: "published" } };
  }

  if (document.status !== "ready_for_review") {
    return { outcome: "invalid_state", currentStatus: document.status };
  }

  // Guarded update: only transitions a row still in `ready_for_review` at
  // write time. If a concurrent publish request already won this race, the
  // update matches zero rows rather than clobbering or double-publishing --
  // the outcome is then reconciled against ground truth below, never
  // assumed.
  const { data: updated, error: updateError } = await supabase
    .from("documents")
    .update({ status: "published" })
    .eq("id", documentId)
    .eq("status", "ready_for_review")
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw new Error(`Failed to publish document ${documentId}: ${updateError.message}`);
  }

  if (!updated) {
    const { data: current, error: recheckError } = await supabase
      .from("documents")
      .select("status")
      .eq("id", documentId)
      .maybeSingle();

    if (recheckError || !current) {
      throw new Error(`Failed to reconcile publish race for document ${documentId}.`);
    }

    if (current.status === "published") {
      return { outcome: "already_published", document: { id: documentId, status: "published" } };
    }

    return { outcome: "invalid_state", currentStatus: current.status };
  }

  return { outcome: "published", document: { id: documentId, status: "published" } };
}
