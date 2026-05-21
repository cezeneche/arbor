"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { IconDropdown } from "@/components/ui/icon-dropdown";
import { useCases } from "@/lib/hooks/useCases";
import { Badge } from "@/components/ui/badge";
import { toStatusVariant, statusLabel, periodLabel } from "@/lib/design-system";

const PAGE_SIZE = 10;

type SortOrder  = "newest" | "oldest";
type FilterMode = "all" | "processed" | "error";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function isProcessed(status: string) {
  return status !== "processing" && status !== "error";
}

export default function CasesPage() {
  const { cases, isLoading, error } = useCases();

  const [sort,   setSort]   = useState<SortOrder>("newest");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [page,   setPage]   = useState(1);

  const filtered = useMemo(() => {
    let list = [...cases];

    if (filter === "processed") list = list.filter(c => isProcessed(c.status));
    if (filter === "error")     list = list.filter(c => c.status === "error");

    list.sort((a, b) => {
      const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return sort === "newest" ? diff : -diff;
    });

    return list;
  }, [cases, filter, sort]);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems   = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function handleFilter(f: FilterMode) {
    setFilter(f);
    setPage(1);
  }

  function handleSort(s: SortOrder) {
    setSort(s);
    setPage(1);
  }


  const pageBtn = (active: boolean): React.CSSProperties => ({
    width:           "32px",
    height:          "32px",
    border:          "var(--border-width) solid var(--color-border)",
    borderRadius:    "6px",
    backgroundColor: active ? "var(--color-navy)" : "var(--color-surface)",
    color:           active ? "#fff" : "var(--color-text-secondary)",
    fontSize:        "var(--text-sm)",
    fontFamily:      "inherit",
    cursor:          active ? "default" : "pointer",
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "center",
  });

  return (
    <div className="page-content">
      {/* ── Header ── */}
      <div
        style={{
          display:        "flex",
          alignItems:     "baseline",
          justifyContent: "space-between",
          marginBottom:   "var(--space-24)",
        }}
      >
        <h1 style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)" }}>
          Cases
        </h1>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          {!isLoading && `${filtered.length} ${filter === "all" ? "total" : filter}`}
        </span>
      </div>

      {/* ── Controls ── */}
      {!isLoading && cases.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", marginBottom: "var(--space-24)" }}>
          <IconDropdown
            icon={SlidersHorizontal}
            value={filter}
            options={[
              { value: "all",       label: "All cases" },
              { value: "processed", label: "Processed" },
              { value: "error",     label: "Error"     },
            ]}
            onChange={handleFilter}
            title="Filter"
          />
          <IconDropdown
            icon={ArrowUpDown}
            value={sort}
            options={[
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
            ]}
            onChange={handleSort}
            title="Sort"
          />
        </div>
      )}

      {isLoading && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          Loading cases…
        </p>
      )}

      {error && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>
          {error.message}
        </p>
      )}

      {!isLoading && !error && cases.length === 0 && (
        <div style={{ paddingTop: "var(--space-80)", paddingBottom: "var(--space-80)", textAlign: "center" }}>
          <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>No cases yet.</p>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-8)" }}>
            Upload a document to create your first case.
          </p>
        </div>
      )}

      {!isLoading && !error && cases.length > 0 && filtered.length === 0 && (
        <div style={{ paddingTop: "var(--space-48)", textAlign: "center" }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            No {filter} cases.
          </p>
        </div>
      )}

      {!isLoading && pageItems.length > 0 && (
        <>
          <div
            style={{
              border:          "var(--border-width) solid var(--color-border)",
              borderRadius:    "var(--card-radius)",
              overflow:        "hidden",
              backgroundColor: "var(--color-surface)",
            }}
          >
            {/* Header row */}
            <div
              style={{
                display:             "grid",
                gridTemplateColumns: "1fr 120px 100px 120px",
                gap:                 "var(--space-16)",
                padding:             "var(--space-16) var(--space-24)",
                borderBottom:        "var(--border-width) solid var(--color-border)",
                backgroundColor:     "var(--color-bg)",
              }}
            >
              {["Importer", "Period", "Status", "Created"].map((col) => (
                <span
                  key={col}
                  style={{
                    fontSize:      "var(--text-xs)",
                    fontWeight:    "var(--font-focal)",
                    color:         "var(--color-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {col}
                </span>
              ))}
            </div>

            {/* Data rows */}
            {pageItems.map((c, i) => (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                style={{
                  display:             "grid",
                  gridTemplateColumns: "1fr 120px 100px 120px",
                  gap:                 "var(--space-16)",
                  padding:             "var(--space-16) var(--space-24)",
                  borderTop:           i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
                  textDecoration:      "none",
                  transition:          "background-color var(--transition-fast)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--color-bg)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent";
                }}
              >
                <div>
                  <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-primary)" }}>
                    {c.importer_name}
                  </p>
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: "var(--space-4)" }}>
                    <span style={{ color: "var(--color-text-tertiary)" }}>Case ID: </span>{c.id}
                  </p>
                </div>

                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", alignSelf: "center" }}>
                  {periodLabel(c.reporting_year, c.reporting_quarter)}
                </span>

                <div style={{ alignSelf: "center" }}>
                  <Badge variant={toStatusVariant(c.status)}>
                    {statusLabel(c.status)}
                  </Badge>
                </div>

                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", alignSelf: "center" }}>
                  {formatDate(c.created_at)}
                </span>
              </Link>
            ))}
          </div>

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div
              style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                gap:            "var(--space-8)",
                marginTop:      "var(--space-24)",
              }}
            >
              <button
                style={{ ...pageBtn(false), width: "auto", padding: "0 var(--space-12)", opacity: currentPage === 1 ? 0.4 : 1, cursor: currentPage === 1 ? "default" : "pointer" }}
                onClick={() => currentPage > 1 && setPage(p => p - 1)}
                disabled={currentPage === 1}
              >
                ←
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  style={pageBtn(n === currentPage)}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ))}

              <button
                style={{ ...pageBtn(false), width: "auto", padding: "0 var(--space-12)", opacity: currentPage === totalPages ? 0.4 : 1, cursor: currentPage === totalPages ? "default" : "pointer" }}
                onClick={() => currentPage < totalPages && setPage(p => p + 1)}
                disabled={currentPage === totalPages}
              >
                →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
