"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { listCbamCases } from "@/lib/api";
import { CaseStatusBadge } from "@/components/cases/CaseStatusBadge";
import type { CBAMCase } from "@/lib/types";

/* ── Skeleton row ─────────────────────────────────────────────────────────── */
function SkeletonRow() {
  return (
    <tr>
      {Array(7).fill(0).map((_, i) => (
        <td key={i} style={{ padding: "var(--space-3) var(--space-4)" }}>
          <div className="skeleton-shimmer" style={{ height: "14px", borderRadius: "var(--radius-sm)" }} />
        </td>
      ))}
    </tr>
  );
}

export default function CasesPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: cases, isLoading, error } = useQuery<CBAMCase[]>({
    queryKey: ["cbam-cases"],
    queryFn: listCbamCases,
    staleTime: 30_000,
  });

  const filtered = (cases ?? []).filter((c) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      c.importer_eori.toLowerCase().includes(q) ||
      (c.importer_name ?? "").toLowerCase().includes(q);
    const matchesStatus =
      statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-4)" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
            Cases
          </h1>
          <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            {cases ? `${cases.length} total CBAM cases` : "Loading…"}
          </p>
        </div>
        <Link
          href="/cases/new"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            height: "var(--touch-min)",
            padding: "0 var(--space-5)",
            borderRadius: "var(--radius-btn)",
            backgroundColor: "var(--color-accent)",
            color: "var(--color-text-on-accent)",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--font-weight-semibold)",
            textDecoration: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          + New Case
        </Link>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by EORI or name…"
          aria-label="Search cases"
          style={{
            flex: "1 1 220px",
            minWidth: 0,
            height: "var(--touch-min)",
            padding: "0 var(--space-4)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface-raised)",
            color: "var(--color-text-primary)",
            fontSize: "var(--text-sm)",
            outline: "none",
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          style={{
            height: "var(--touch-min)",
            padding: "0 var(--space-4)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface-raised)",
            color: "var(--color-text-primary)",
            fontSize: "var(--text-sm)",
            cursor: "pointer",
          }}
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="processing">Processing</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Error */}
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
              {["Importer EORI", "Company", "Quarter", "Status", "Review", "Created", ""].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "var(--space-3) var(--space-4)",
                    fontSize: "11px",
                    fontWeight: "var(--font-weight-semibold)",
                    color: "var(--color-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "var(--tracking-wider)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array(6).fill(0).map((_, i) => <SkeletonRow key={i} />)
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "var(--space-12) var(--space-4)", textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
                  {search || statusFilter !== "all"
                    ? "No cases match this filter."
                    : "No shipments yet. Upload your first invoice to get started."}
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr
                  key={c.id}
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-surface-raised)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                >
                  <td style={{ padding: "var(--space-3) var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-accent-text)", whiteSpace: "nowrap" }}>
                    {c.importer_eori}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-4)", color: "var(--color-text-primary)" }}>
                    {c.importer_name ?? "—"}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-4)", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                    Q{c.reporting_quarter} {c.reporting_year}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-4)" }}>
                    <CaseStatusBadge status={c.status} />
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-4)" }}>
                    <CaseStatusBadge status={c.review_status} />
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-4)", color: "var(--color-text-muted)", fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "var(--space-3) var(--space-4)", textAlign: "right" }}>
                    <Link
                      href={`/cases/${c.id}`}
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: "var(--font-weight-semibold)",
                        color: "var(--color-accent-text)",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      View →
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
