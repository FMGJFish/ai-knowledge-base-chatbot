import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

// Analytics Service (Phase 9, Increments 1 and 3). Owns both event
// recording and event reading against the existing `analytics_events`
// table only (phase9_execution_strategy_v1.md, Increment 1/Increment 3
// Boundaries). No wiring into any Route Handler, page, component, or
// background process beyond the single admin-gated read consumer
// authorized under Increment 3. Reads and writes only against
// `analytics_events`.

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

export interface AnalyticsEventSummary {
  id: string;
  eventType: string;
  referenceId: string | null;
  referenceType: string | null;
  occurredAt: string;
}

// Lists every recorded Analytics Event, ordered by `occurred_at` descending
// (most recent first) -- fixed, non-configurable, per the accepted
// Increment 3 API contract. No filter, pagination, or sort parameter is
// accepted or interpreted.
export async function listEvents(): Promise<AnalyticsEventSummary[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("analytics_events")
    .select("id, event_type, reference_id, reference_type, occurred_at")
    .order("occurred_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list analytics events: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    referenceId: row.reference_id,
    referenceType: row.reference_type,
    occurredAt: row.occurred_at,
  }));
}
