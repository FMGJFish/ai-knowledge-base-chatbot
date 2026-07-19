import "server-only";
import { timingSafeEqual } from "node:crypto";

// Knowledge Processing Service — internal service-to-service authentication
// (Phase 4, Increment 3). Guards the internal processing Route Handler that
// the approved trigger architecture (confirmDocumentIntake -> after() ->
// internal Route Handler) calls. Uses a plain shared-secret comparison via
// INTERNAL_SERVICE_SECRET (already reserved in .env.example since Phase 2
// for exactly this purpose) rather than a signed token: this is a direct
// server-to-server call, not a value round-tripped through the browser, so
// the upload-intent continuity token's claims/expiry machinery
// (ADR Decision 017) is unnecessary here.
export const INTERNAL_SERVICE_SECRET_HEADER = "x-internal-service-secret";

function getInternalServiceSecret(): string {
  const secret = process.env.INTERNAL_SERVICE_SECRET;

  if (!secret) {
    throw new Error("Missing INTERNAL_SERVICE_SECRET server configuration.");
  }

  return secret;
}

export function verifyInternalServiceRequest(providedSecret: string | null): boolean {
  if (!providedSecret) {
    return false;
  }

  const expected = Buffer.from(getInternalServiceSecret(), "utf8");
  const provided = Buffer.from(providedSecret, "utf8");

  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
