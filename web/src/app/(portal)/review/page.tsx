"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { listCbamCases } from "@/lib/api";
import type { CBAMCase } from "@/lib/types";

function SkeletonRow() {
  return (
    <tr>
      {Array(5).fill(0).map((_, i) => (
        <td key={i} style={{ padding: "var(--space-3) var(--space-4)" }}>
          <div className="skeleton-shimmer" style={{ height: "14px", borderRadius: "var(--radius-sm)" }} />
        </td>
      ))}
    </tr>
  );
}

export default function ReviewQueuePage() {
  const { data: cases, isLoading, error } = useQuery<CBAMCase[]>({
    queryKey: ["cbam-cases"],
    queryFn: listCbamCases,
    staleTime: 30_000,
  });

  const queue = (cases ?? []).filter((c) => c.review_status === "pending_review");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span style={{ fontSize: "22px" }} aria-hidden="true">⚠</span>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
            Review Queue
          </h1>
          <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            {isLoading ? "Loading…" : `${queue.length} case${queue.length !== 1 ? "s" : ""} awaiting decision`}
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)", backgroundColor: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", color: "var(--color-error-text)", fontSize: "var(--text-sm)" }}>
          Failed to load cases — {(error as Error).message}
        </div>
      )}

      {/* Table */}
      <div style={{ borderRadius: "var(--radius-xl)", border: "1px solid var(--color-border)", overflow: "hidden", backgroundColor: "var(--color-surface)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              {["Importer EORI", "Company", "Period", "Case ID", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "var(--space-3) var(--space-4)", fontSize: "11px", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-wider)", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array(3).fill(0).map((_, i) => <SkeletonRow key={i} />)
            ) : queue.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: "var(--space-12) var(--space-4)", textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
                  No cases pending review. ✓
                </td>
              </tr>
            ) : (
              queue.map((c) => (
                <tr
                  key={c.id}
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-surface-raised)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                >
                  <td style={{ padding: "var(--space-3) var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-pending-text)", whiteSpace: "nowrap" }}>
                    {c.importer_eori}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-4)", color: "var(--color-text-primary)" }}>
                    {c.importer_name ?? "—"}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-4)", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                    Q{c.reporting_quarter} {c.reporting_year}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                    {c.id.slice(0, 8)}…
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-4)", textAlign: "right" }}>
                    <Link
                      href={`/review/${c.id}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        height: "32px",
                        padding: "0 var(--space-4)",
                        borderRadius: "var(--radius-md)",
                        backgroundColor: "var(--color-pending-bg)",
                        border: "1px solid var(--color-pending-border)",
                        color: "var(--color-pending-text)",
                        fontSize: "var(--text-xs)",
                        fontWeight: "var(--font-weight-semibold)",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Review →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
