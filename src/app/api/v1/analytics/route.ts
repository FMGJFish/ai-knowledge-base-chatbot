import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase/session";
import { listEvents } from "@/lib/services/analytics/analytics";

// Analytics API Resource Route Handler (Phase 9, Increment 3). Read-only,
// admin-gated exposure of Increment 1's Analytics Service `listEvents()`
// capability. No query parameter is accepted or interpreted; ordering is
// fixed server-side in the Analytics Service, not here.

export async function GET() {
  const user = await getAdminUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const events = await listEvents();
    return NextResponse.json({ events }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "analytics_unavailable" }, { status: 500 });
  }
}
