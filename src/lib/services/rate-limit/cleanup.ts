import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import {
  CLEANUP_BATCH_SIZE,
  CLEANUP_RETENTION_SECONDS,
  CLEANUP_TRIGGER_PROBABILITY,
} from "./config";

// Rate Limit Service — bounded stale-row cleanup (Phase 7, Increment 2).
// Best-effort operational maintenance, entirely separate from the
// correctness-critical rate-limit decision (phase7_execution_strategy_v1.md,
// Increment 2 Architectural Determinations: retention/cleanup model,
// cleanup failure-handling interpretation). A cleanup failure must never
// alter a rate-limit result, fail an otherwise valid request, or block
// public request processing -- it is isolated here and only ever recorded
// through structured operational telemetry, never thrown to the caller.
export async function maybeRunCleanupSweep(): Promise<void> {
  if (Math.random() >= CLEANUP_TRIGGER_PROBABILITY) {
    return;
  }

  try {
    const supabase = createServiceClient();

    const { error } = await supabase.rpc("cleanup_stale_rate_limit_counters", {
      p_retention_seconds: CLEANUP_RETENTION_SECONDS,
      p_batch_size: CLEANUP_BATCH_SIZE,
    });

    if (error) {
      logCleanupFailure(error.message);
    }
  } catch (err) {
    logCleanupFailure(err instanceof Error ? err.message : String(err));
  }
}

// Structured operational telemetry, per the Technical Specification's
// Logging & Observability section (native platform capabilities -- Vercel
// logging -- are sufficient for Version 1; no dedicated third-party
// monitoring platform, ADR Decision 014). A fixed, greppable shape
// supports diagnosis and repeated-failure detection without exposing this
// as a public-facing error.
function logCleanupFailure(message: string): void {
  console.error(
    JSON.stringify({
      event: "rate_limit_cleanup_failed",
      message,
      timestamp: new Date().toISOString(),
    })
  );
}
