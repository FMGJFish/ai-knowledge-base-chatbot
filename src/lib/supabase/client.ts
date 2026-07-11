import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// Browser-safe Supabase client, authenticated with the publishable key.
// Subject to Row Level Security. Intended for the Admin Dashboard's
// Supabase Auth sign-in flow (Implementation Roadmap Phase 3) — not for
// direct table access, which remains behind the service layer.
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing Supabase browser configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set."
    );
  }

  return createClient<Database>(url, publishableKey);
}
