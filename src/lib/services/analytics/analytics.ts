import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

// Analytics Service (Phase 9, Increment 1). Owns event recording against
// the existing `analytics_events` table only
// (phase9_execution_strategy_v1.md, Increment 1 Boundary). Exposes exactly
// one write capability -- no read/query capability (Increment 3), and no
// wiring into any Route Handler, page, component, or background process
// (Increment 2). Reads and writes only against `analytics_events`.

export interface RecordEventInput {
  eventType: string;
  referenceId?: string;
  referenceType?: string;
}

// Records a single Analytics Event via exactly one `analytics_events`
// insert. `referenceId`/`referenceType` form a polymorphic pointer to a
// Document, Conversation, or Message (03_database_design_v1.md), so no
// single foreign key constraint applies; both are optional.
export async function recordEvent(input: RecordEventInput): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase.from("analytics_events").insert({
    event_type: input.eventType,
    reference_id: input.referenceId ?? null,
    reference_type: input.referenceType ?? null,
  });

  if (error) {
    throw new Error(`Failed to record analytics event: ${error.message}`);
  }
}
