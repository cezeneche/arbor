"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getReportPackage } from "@/lib/api";

interface Props { params: Promise<{ id: string }> }

export default function ReportPage({ params }: Props) {
  const { id } = use(params);

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["report-package", id],
    queryFn: () => getReportPackage(id),
  });

  function downloadJson() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `cbam-report-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ maxWidth: "720px", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <Link href={`/cases/${id}`} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textDecoration: "none" }}>
        ← Back to case
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-4)" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
            Report Package
          </h1>
          <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
            {id}
          </p>
        </div>
        {report && (
          <button
            type="button"
            onClick={downloadJson}
            style={{
              height: "var(--touch-min)",
              padding: "0 var(--space-5)",
              borderRadius: "var(--radius-btn)",
              border: "none",
              backgroundColor: "var(--color-accent)",
              color: "var(--color-text-on-accent)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--font-weight-semibold)",
              cursor: "pointer",
            }}
          >
            ↓ Download JSON
          </button>
        )}
      </div>

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {Array(3).fill(0).map((_, i) => (
            <div key={i} className="skeleton-shimmer" style={{ height: "80px", borderRadius: "var(--radius-lg)" }} />
          ))}
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)", backgroundColor: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", color: "var(--color-error-text)", fontSize: "var(--text-sm)" }}>
          <p style={{ margin: "0 0 4px", fontWeight: "var(--font-weight-semibold)" }}>{(error as Error).message}</p>
          <p style={{ margin: 0, opacity: 0.75, fontSize: "var(--text-xs)" }}>
            The report package may not be available yet — run the narrative pipeline first.
          </p>
        </div>
      )}

      {report && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {/* Emissions summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-4)" }}>
            {[
              { label: "Direct CO₂e",   value: `${(report.total_direct_kgco2e   / 1000).toFixed(2)} tCO₂e` },
              { label: "Indirect CO₂e", value: `${(report.total_indirect_kgco2e / 1000).toFixed(2)} tCO₂e` },
              { label: "Total CO₂e",    value: `${(report.total_kgco2e           / 1000).toFixed(2)} tCO₂e` },
            ].map(({ label, value }) => (
              <div key={label} style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-xl)", padding: "var(--space-5)" }}>
                <p style={{ margin: "0 0 var(--space-1)", fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-wide)" }}>{label}</p>
                <p style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: "var(--font-weight-bold)", color: "var(--color-text-primary)" }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Raw JSON preview */}
          <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-xl)", padding: "var(--space-5)" }}>
            <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-xs)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-wide)" }}>
              Raw report package
            </p>
            <pre style={{ margin: 0, fontSize: "11px", color: "var(--color-text-secondary)", overflowX: "auto", maxHeight: "400px", fontFamily: "var(--font-mono)", backgroundColor: "var(--color-page)", padding: "var(--space-4)", borderRadius: "var(--radius-lg)", border: "1px solid var(--color-border)" }}>
              {JSON.stringify(report, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
