/**
 * (portal) layout — authenticated portal shell
 *
 * Server component — no hooks or state here. Wraps all portal pages in
 * PortalShell (client component) which handles:
 *
 *   1. Auth guard: reads JWT from localStorage on mount, redirects to
 *      /login if the token is absent or expired.
 *
 *   2. Layout composition: fixed Sidebar (desktop/tablet) + TopBar
 *      (mobile) + main content area with max-width 1200px.
 *
 *   3. User info: decoded from JWT and passed to Sidebar (initials avatar,
 *      sub, tenant_id).
 *
 * The middleware.ts also redirects unauthenticated requests at the edge,
 * before the page renders — PortalShell provides the client-side expiry check.
 */

import { PortalShell } from "@/components/layout/PortalShell";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PortalShell>{children}</PortalShell>;
}
