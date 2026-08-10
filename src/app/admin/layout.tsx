import Link from "next/link";
import { getAdminUser } from "@/lib/supabase/session";
import { SignOutButton } from "./sign-out-button";

// Shared administrative navigation (bounded portfolio-readiness/usability
// correction). Wraps every /admin/* route by Next.js layout convention,
// including /admin/login -- but getAdminUser() returns null only on
// /admin/login (src/proxy.ts already redirects every other unauthenticated
// /admin/* request before this layout renders), so the nav is simply
// omitted there rather than requiring a separate pathname check.
const ADMIN_NAV_LINKS = [
  { href: "/admin", label: "ARIK Admin" },
  { href: "/admin/documents", label: "Documents" },
  { href: "/admin/configuration", label: "Configuration" },
  { href: "/admin/preview", label: "Test / Preview" },
  { href: "/admin/analytics", label: "Activity" },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAdminUser();

  if (!user) {
    return <>{children}</>;
  }

  return (
    <>
      <nav className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        {ADMIN_NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded border px-3 py-1 text-sm font-medium text-brand-700"
          >
            {link.label}
          </Link>
        ))}
        <SignOutButton />
      </nav>
      {children}
    </>
  );
}
