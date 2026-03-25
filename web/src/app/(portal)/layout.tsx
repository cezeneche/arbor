import { TopBar } from "@/components/layout/TopBar";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--color-bg)" }}>
      <TopBar />
      <main style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}>
        {children}
      </main>
    </div>
  );
}
