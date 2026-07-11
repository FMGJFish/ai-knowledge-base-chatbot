import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";
import type { User } from "@supabase/supabase-js";
import { isAuthorizedAdminEmail } from "./admin-allowlist";

// Request-scoped, cookie-bound Supabase client for reading the
// authenticated administrator's session in Server Components, Route
// Handlers, and Server Actions. Uses the publishable key (subject to Row
// Level Security) — this is a session-identity client, not the
// RLS-bypassing service client in server.ts, and must not be used for
// general data access.
export async function createSessionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing Supabase session configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set."
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Middleware is responsible for refreshing the session in that case.
        }
      },
    },
  });
}

// Returns the authenticated AND authorized administrator, or null.
// Authentication alone (a valid Supabase Auth session, always re-verified
// via getUser() rather than trusting the cookie) is not sufficient — the
// user's email must also be on ADMIN_EMAIL_ALLOWLIST (see
// admin-allowlist.ts). A successfully authenticated Supabase Auth user
// who is not allowlisted is not an administrator.
export async function getAdminUser(): Promise<User | null> {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAuthorizedAdminEmail(user.email)) {
    return null;
  }

  return user;
}
