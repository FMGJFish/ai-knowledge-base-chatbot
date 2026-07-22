// Rate Limit Service — implementation configuration (Phase 7, Increment 2).
// Numeric/timing values only. These are engineering-judgment defaults, not
// architectural decisions (phase7_execution_strategy_v1.md, Increment 2
// Architectural Determinations) -- tune freely without governance review.
//
// CLEANUP_RETENTION_SECONDS must remain comfortably larger than either
// window duration below, so the bounded stale-row sweep
// (cleanup_stale_rate_limit_counters) can never delete a row still inside
// its active enforcement window.

export const IP_LAYER_WINDOW_SECONDS = 60;
export const IP_LAYER_MAX_REQUESTS = 30;

// Version 1 has exactly one Chatbot Configuration (ADR Decision 016), so
// this layer is effectively a deployment-wide aggregate limit -- sized
// well above the per-IP limit accordingly.
export const CHATBOT_IDENTIFIER_LAYER_WINDOW_SECONDS = 60;
export const CHATBOT_IDENTIFIER_LAYER_MAX_REQUESTS = 300;

export const CLEANUP_RETENTION_SECONDS = 60 * 60; // 1 hour -- 60x the longest window above.
export const CLEANUP_BATCH_SIZE = 500;
export const CLEANUP_TRIGGER_PROBABILITY = 0.01; // ~1 in 100 requests triggers a sweep.
