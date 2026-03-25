"use client";

import { useAuth } from "@/lib/auth/useAuth";
import { TopBar } from "@/components/layout/TopBar";

/**
 * Portal layout — conditionally shows TopBar.
 * Unauthenticated state (scope checker at /) gets a clean full-viewport canvas.
 * Authenticated state gets the sticky TopBar + standard page padding.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const authed = !isLoading && !!user;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--color-bg)" }}>
      {authed && <TopBar />}
      <main
        style={{
          paddingTop:    authed ? "var(--space-48)" : 0,
          paddingBottom: authed ? "var(--space-80)" : 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}
