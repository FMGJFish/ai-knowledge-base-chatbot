import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// Server-signed, opaque upload-intent continuity token (Phase 4, Increment 1
// revision). Binds the claims the Knowledge Processing Service approved at
// upload authorization so that, at completion, it can prove the request
// traces back to a genuine, unaltered intake decision — rather than trusting
// object existence alone (CSA ruling: authorization decision -> later
// verification -> continuity evidence). HMAC-SHA256 via node:crypto only;
// no signing/JWT dependency is installed. The signing secret
// (UPLOAD_INTENT_SIGNING_SECRET) never leaves this module; only the signed
// token (claims + signature) crosses to the browser.
//
// Administrator identity is intentionally not bound in these claims: all
// allowlisted administrators hold equivalent privilege (ADR Decision 009),
// and the Phase 3 authorization boundary is independently re-verified at
// completion regardless of which administrator obtained the original token
// (see Upload Intent Responsibility Boundary Reconciliation).
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour: safely under Supabase's ~2-hour signed-upload-URL expiry

export interface UploadIntentClaims {
  storagePath: string;
  filename: string;
  contentType: string;
  declaredSize: number;
  nonce: string;
  iat: number;
  exp: number;
}

function getSigningSecret(): string {
  const secret = process.env.UPLOAD_INTENT_SIGNING_SECRET;

  if (!secret) {
    throw new Error("Missing UPLOAD_INTENT_SIGNING_SECRET server configuration.");
  }

  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSigningSecret()).update(payload).digest("base64url");
}

export function createUploadIntentToken(
  claims: Pick<UploadIntentClaims, "storagePath" | "filename" | "contentType" | "declaredSize">
): string {
  const now = Date.now();
  const fullClaims: UploadIntentClaims = {
    ...claims,
    nonce: randomUUID(),
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };

  const encodedClaims = Buffer.from(JSON.stringify(fullClaims), "utf8").toString("base64url");
  const signature = sign(encodedClaims);

  return `${encodedClaims}.${signature}`;
}

export type TokenVerificationResult =
  | { valid: true; claims: UploadIntentClaims }
  | { valid: false; reason: "malformed" | "invalid_signature" | "expired" };

export function verifyUploadIntentToken(token: string): TokenVerificationResult {
  const parts = token.split(".");

  if (parts.length !== 2) {
    return { valid: false, reason: "malformed" };
  }

  const encodedClaims = parts[0];
  const signature = parts[1];

  if (!encodedClaims || !signature) {
    return { valid: false, reason: "malformed" };
  }

  const expectedSignature = sign(encodedClaims);

  const providedSignatureBuffer = Buffer.from(signature, "base64url");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "base64url");

  if (
    providedSignatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(providedSignatureBuffer, expectedSignatureBuffer)
  ) {
    return { valid: false, reason: "invalid_signature" };
  }

  let claims: UploadIntentClaims;

  try {
    claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (typeof claims.exp !== "number" || Date.now() > claims.exp) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, claims };
}
