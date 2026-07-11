import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

// Browser-safe Supabase client, authenticated with the publishable key.
// Subject to Row Level Security. Used by the Admin Dashboard's Supabase
// Auth sign-in flow (Implementation Roadmap Phase 3) — not for direct
// table access, which remains behind the service layer.
//
// Uses @supabase/ssr's browser client (not plain @supabase/supabase-js)
// so the session is also written to cookies, not just localStorage —
// required for Middleware and Route Handlers to see the same session
// established here, per the Technical Specification's requirement that
// "all Admin Dashboard and admin-scoped API routes require a valid
// session."
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing Supabase browser configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set."
    );
  }

  return createSupabaseBrowserClient<Database>(url, publishableKey);
}
