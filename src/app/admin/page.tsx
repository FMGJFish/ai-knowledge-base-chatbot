import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/supabase/session";
import { SignOutButton } from "./sign-out-button";

// Minimal protected Admin Dashboard placeholder (Implementation Roadmap
// Phase 3). Proves the authorization boundary end-to-end: only reachable
// with a valid Supabase Auth session. Document upload, chatbot
// configuration, testing, and analytics surfaces are Phase 8 scope and
// are intentionally not implemented here.
//
// src/middleware.ts already redirects unauthenticated requests before
// this page renders; this server-side check is defense-in-depth, per the
// Technical Specification's assignment of authentication/authorization
// responsibility to the server (not solely to Middleware).
export default async function AdminPage() {
  const user = await getAdminUser();

  if (!user) {
    redirect("/admin/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-start gap-4 p-6">
      <h1 className="text-xl font-semibold">Admin Dashboard</h1>
      <p>Signed in as {user.email}</p>
      <SignOutButton />
    </main>
  );
}
