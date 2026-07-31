import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/supabase/session";
import { AnalyticsPanel } from "./analytics-panel";

// Analytics Panel Scaffold (Implementation Roadmap Phase 8, Increment 4).
// Server-side admin check is defense-in-depth -- src/proxy.ts already
// redirects unauthenticated requests before this page renders -- matching
// the same pattern already established by src/app/admin/page.tsx,
// src/app/admin/documents/page.tsx, src/app/admin/configuration/page.tsx,
// and src/app/admin/preview/page.tsx.
//
// Presentation only: a static placeholder scaffold with no live data
// source. Introduces no Analytics Service, Analytics API, or
// analytics_events access of any kind -- that capability remains Phase 9
// scope in full, per the Increment 4 Delegation Package.
export default async function AdminAnalyticsPage() {
  const user = await getAdminUser();

  if (!user) {
    redirect("/admin/login");
  }

  return (
    <main className="flex min-h-screen flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Analytics</h1>
      <AnalyticsPanel />
    </main>
  );
}
