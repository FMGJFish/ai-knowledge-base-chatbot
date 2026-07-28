import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/supabase/session";
import { DocumentsPanel } from "./documents-panel";

// Document Management Surface (Implementation Roadmap Phase 8, Increment
// 1). Server-side admin check is defense-in-depth -- src/proxy.ts already
// redirects unauthenticated requests before this page renders -- matching
// the same pattern already established by src/app/admin/page.tsx.
//
// Presentation only: every document/knowledge operation delegates to the
// already-implemented, already-admin-gated Documents and Knowledge
// Management resources (Phase 4) via DocumentsPanel; this route
// introduces no new API endpoint, no new persistence, and no new
// business logic.
export default async function AdminDocumentsPage() {
  const user = await getAdminUser();

  if (!user) {
    redirect("/admin/login");
  }

  return (
    <main className="flex min-h-screen flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Document Management</h1>
      <DocumentsPanel />
    </main>
  );
}
