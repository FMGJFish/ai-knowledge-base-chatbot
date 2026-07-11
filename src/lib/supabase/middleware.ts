import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedAdminEmail } from "./admin-allowlist";

// Refreshes the Supabase Auth session cookie for the current request and
// returns the resulting response along with the authenticated AND
// authorized administrator (or null). Used by src/proxy.ts to gate
// admin-scoped routes. This is the one context where the
// secret-key/publishable-key distinction from server.ts/session.ts does
// not apply — this always uses the publishable key, since it is only
// reading/refreshing the visitor's own session, never bypassing Row
// Level Security.
//
// The returned `user` is filtered through isAuthorizedAdminEmail() —
// see admin-allowlist.ts for the single, centralized authorization
// decision shared with session.ts. A session cookie is still refreshed
// even for a non-allowlisted authenticated identity (session hygiene is
// independent of authorization), but such an identity is never returned
// as `user`, so src/proxy.ts's existing "!user" check denies them.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing Supabase middleware configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set."
    );
  }

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user: authenticatedUser },
  } = await supabase.auth.getUser();

  const user =
    authenticatedUser && isAuthorizedAdminEmail(authenticatedUser.email) ? authenticatedUser : null;

  return { response, user };
}
