import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Enforces the Phase 3 administrative authorization boundary: every
// /admin route requires a valid Supabase Auth session, except the sign-in
// page itself. This is the primary redirect mechanism for the Admin
// Dashboard UI; src/lib/supabase/session.ts provides the equivalent
// server-verified check for Route Handlers (see
// src/app/api/v1/admin/session/route.ts), since the Technical
// Specification assigns authentication/authorization responsibility to
// Route Handlers, not only to Middleware.
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const isLoginRoute = request.nextUrl.pathname === "/admin/login";

  if (!user && !isLoginRoute) {
    const redirectUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
