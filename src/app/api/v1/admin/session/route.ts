import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";

// Minimal admin-scoped Route Handler demonstrating the Phase 3
// authorization boundary at the API layer (Technical Specification,
// Backend Design: Route Handlers are responsible for authentication and
// authorization, never business logic). This route exists to verify the
// Implementation Roadmap's Phase 3 completion criterion — "unauthenticated
// requests to admin-scoped routes are rejected" — at the Route Handler
// level, not only via Middleware. It is not a Documents/Configuration/
// Analytics endpoint; those remain later-phase scope.
export async function GET() {
  const user = await getAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ email: user.email });
}
