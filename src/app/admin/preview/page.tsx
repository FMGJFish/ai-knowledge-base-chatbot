import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/supabase/session";
import { PreviewPanel } from "./preview-panel";

// Test/Preview Surface (Implementation Roadmap Phase 8, Increment 3).
// Server-side admin check is defense-in-depth -- src/proxy.ts already
// redirects unauthenticated requests before this page renders -- matching
// the same pattern already established by src/app/admin/page.tsx,
// src/app/admin/documents/page.tsx, and src/app/admin/configuration/page.tsx.
//
// Presentation only: exchanges delegate to POST /api/v1/admin/preview,
// which executes statelessly per AD-035 -- no Conversation or Message
// record is created by this surface under any circumstance.
export default async function AdminPreviewPage() {
  const user = await getAdminUser();

  if (!user) {
    redirect("/admin/login");
  }

  return (
    <main className="flex min-h-screen flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Test / Preview</h1>
      <PreviewPanel />
    </main>
  );
}
