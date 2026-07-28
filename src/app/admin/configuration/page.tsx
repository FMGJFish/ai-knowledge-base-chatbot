import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/supabase/session";
import { ConfigurationForm } from "./configuration-form";

// Administrative Configuration Surface (Implementation Roadmap Phase 8,
// Increment 2). Server-side admin check is defense-in-depth -- src/proxy.ts
// already redirects unauthenticated requests before this page renders --
// matching the same pattern already established by src/app/admin/page.tsx
// and src/app/admin/documents/page.tsx.
//
// Presentation only: reads and writes delegate to
// GET/PUT /api/v1/configuration; this route introduces no new persistence
// or business logic beyond the Route-Handler-level boundary validation
// authorized by the Increment 2 Delegation Package.
export default async function AdminConfigurationPage() {
  const user = await getAdminUser();

  if (!user) {
    redirect("/admin/login");
  }

  return (
    <main className="flex min-h-screen flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Administrative Configuration</h1>
      <ConfigurationForm />
    </main>
  );
}
