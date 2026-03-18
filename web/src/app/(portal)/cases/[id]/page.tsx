"use client";

// use removed from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getCbamCase } from "@/lib/api";
import { CaseStatusBadge } from "@/components/cases/CaseStatusBadge";

interface Props { params: { id: string } }

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-xl)",
  padding: "var(--space-5)",
};

const actionCardStyle: React.CSSProperties = {
  display: "block",
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-xl)",
  padding: "var(--space-5)",
  textDecoration: "none",
  transition: "border-color var(--transition-normal)",
};

function SkeletonBlock({ h = 20 }: { h?: number }) {
  return <div className="skeleton-shimmer" style={{ height: h, borderRadius: "var(--radius-sm)" }} />;
}

export default function CaseDetailPage({ params }: Props) {
  const { id } = params;
  const { data: c, isLoading, error } = useQuery({
    queryKey: ["cbam-case", id],
    queryFn: () => getCbamCase(id),
  });

  return (
    <div style={{ maxWidth: "800px", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <Link href="/cases" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textDecoration: "none" }}>
        ← Back to cases
      </Link>

      {error && (
        <div role="alert" style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)", backgroundColor: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", color: "var(--color-error-text)", fontSize: "var(--text-sm)" }}>
          Failed to load case — {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <SkeletonBlock h={32} />
          <SkeletonBlock h={120} />
        </div>
      ) : c ? (
        <>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
                {c.importer_eori}
              </h1>
              {c.importer_name && (
                <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  {c.importer_name}
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <CaseStatusBadge status={c.status} />
              {c.review_status && <CaseStatusBadge status={c.review_status} />}
            </div>
          </div>

          {/* Meta */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-4)" }}>
            {[
              { label: "Reporting period", value: `Q${c.reporting_quarter} ${c.reporting_year}` },
              { label: "Tenant",           value: c.tenant_id },
              { label: "Case ID",          value: c.id.slice(0, 8) + "…" },
            ].map(({ label, value }) => (
              <div key={label} style={cardStyle}>
                <p style={{ margin: "0 0 var(--space-1)", fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-wide)" }}>{label}</p>
                <p style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Action cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {[
              { href: `/cases/${id}/pipeline`, title: "Narrative Pipeline", desc: "Run the OpenAI → Claude → Gemini pipeline and view the generated compliance narrative." },
              { href: `/cases/${id}/audit`,    title: "Audit Chain",        desc: "HMAC-signed event ledger — every state transition with hash verification." },
              { href: `/cases/${id}/report`,   title: "Report Package",     desc: "View and download the final CBAM compliance report bundle." },
            ].map(({ href, title, desc }) => (
              <Link
                key={href}
                href={href}
                style={actionCardStyle}
                onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--color-accent-border)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--color-border)")}
              >
                <p style={{ margin: "0 0 var(--space-1)", fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-accent-text)" }}>
                  {title} →
                </p>
                <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>{desc}</p>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
