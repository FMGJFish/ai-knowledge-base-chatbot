import "server-only";

// Centralized administrator authorization decision (Phase 3 correction,
// Chief Software Architect ruling: layered correction after confirming
// Staging Auth self-service signup was enabled while the application
// treated any authenticated Supabase Auth identity as an administrator).
//
// Authentication (a valid Supabase Auth session) is necessary but not
// sufficient. Authorization is a separate question: is this identity's
// email on the administrator allowlist? This is the single place that
// question is answered — src/lib/supabase/session.ts (Server
// Components/Route Handlers) and src/lib/supabase/middleware.ts (Proxy)
// both call this function rather than re-implementing the comparison.
//
// Fails closed: if ADMIN_EMAIL_ALLOWLIST is missing, empty, or contains
// no valid entries after normalization, no email is authorized.
function parseAllowlist(): Set<string> {
  const raw = process.env.ADMIN_EMAIL_ALLOWLIST ?? "";

  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );
}

export function isAuthorizedAdminEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }

  const allowlist = parseAllowlist();

  if (allowlist.size === 0) {
    return false;
  }

  return allowlist.has(email.trim().toLowerCase());
}
