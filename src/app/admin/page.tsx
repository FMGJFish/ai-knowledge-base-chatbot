import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/supabase/session";
import { SignOutButton } from "./sign-out-button";

// Minimal protected Admin Dashboard placeholder (Implementation Roadmap
// Phase 3). Proves the authorization boundary end-to-end: only reachable
// with a valid Supabase Auth session. Analytics surfaces remain Phase 8
// scope not yet implemented here; Document Management now lives at
// /admin/documents (Phase 8, Increment 1), Administrative Configuration at
// /admin/configuration (Phase 8, Increment 2), and Test/Preview at
// /admin/preview (Phase 8, Increment 3).
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
      <p className="text-lg font-semibold text-brand-700">ARIK</p>
      <h1 className="text-xl font-semibold">Admin Dashboard</h1>
      <p>Signed in as {user.email}</p>
      <Link href="/admin/documents" className="rounded-lg bg-brand-600 px-3 py-2 text-white">
        Document Management
      </Link>
      <Link href="/admin/configuration" className="rounded-lg bg-brand-600 px-3 py-2 text-white">
        Administrative Configuration
      </Link>
      <Link href="/admin/preview" className="rounded-lg bg-brand-600 px-3 py-2 text-white">
        Test / Preview
      </Link>
      <Link href="/admin/analytics" className="rounded-lg bg-brand-600 px-3 py-2 text-white">
        Analytics
      </Link>
      <SignOutButton />
    </main>
  );
}
