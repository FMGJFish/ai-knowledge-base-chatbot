import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// Server-only Supabase client, authenticated with the secret key. This
// bypasses Row Level Security and must never be imported into client
// components or exposed to the browser. Per the Technical Specification's
// Backend Design, only service modules (added in later Implementation
// Roadmap phases) may use this client — never Route Handlers directly.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Missing Supabase server configuration: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set."
    );
  }

  return createClient<Database>(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
