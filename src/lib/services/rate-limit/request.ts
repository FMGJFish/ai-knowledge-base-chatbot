import "server-only";

// Rate Limit Service — trusted client-IP extraction (Phase 7, Increment 2).
// Reads only the platform-set forwarding headers Vercel's edge network
// populates (x-forwarded-for's first entry is the original client;
// x-real-ip as a fallback) -- never a client-controlled body field, so the
// IP layer cannot be spoofed by request content. Returns null when neither
// header is present; the caller (enforceRateLimit) fails closed in that
// case rather than allow an unattributable request through the IP layer.
export function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const firstEntry = forwardedFor.split(",")[0]?.trim();

    if (firstEntry) {
      return firstEntry;
    }
  }

  return request.headers.get("x-real-ip");
}
