"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { SlidersHorizontal, ArrowUpDown, Search } from "lucide-react";
import { IconDropdown } from "@/components/ui/icon-dropdown";
import { useAuth } from "@/lib/auth/useAuth";
import { useCases } from "@/lib/hooks/useCases";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PublicScopeChecker } from "@/components/features/scope-checker/PublicScopeChecker";
import {
  formatCurrency,
  toStatusVariant,
  statusLabel,
  methodBadgeVariant,
  methodLabel,
} from "@/lib/design-system";
import { sectorLabel } from "@/lib/constants";
import type { Case } from "@/lib/api/types";

const PAGE_SIZE = 10;

type SortOrder  = "newest" | "oldest";
type FilterMode = "all" | "processed" | "error";

function isProcessed(status: string) {
  return status !== "processing" && status !== "error";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Dashboard — authenticated state ───────────────────────────────────────────

// Extended case shape — list API may return enriched fields
type CaseListItem = Case & {
  sector?:                  string | null;
  origin_country?:          string | null;
  predominant_method?:      string | null;
  estimated_liability_gbp?: number | null;
  total_net_mass_kg?:       number | null;
};

function Dashboard() {
  const { cases: rawCases, isLoading } = useCases();
  const cases = rawCases as CaseListItem[];

  const [sort,   setSort]   = useState<SortOrder>("newest");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [page,   setPage]   = useState(1);

  // Total estimated liability — summed from per-case estimated_liability_gbp when available
  const totalLiability = cases.length > 0 && cases.some((c) => c.estimated_liability_gbp != null)
    ? cases.reduce((sum, c) => sum + (c.estimated_liability_gbp ?? 0), 0)
    : null;

  // Most recent updated_at
  const lastUpdated =
    cases.length > 0
      ? cases.reduce((latest, c) => (c.updated_at > latest ? c.updated_at : latest), cases[0].updated_at)
      : null;

  // Pending review alert — only surfaced action on the dashboard
  const pendingReview = cases.filter((c) => c.review_status === "pending_review");
  const hasPendingReview = pendingReview.length > 0;

  const filtered = useMemo(() => {
    let list = [...cases];
    if (filter === "processed") list = list.filter(c => isProcessed(c.status));
    if (filter === "error")     list = list.filter(c => c.status === "error");
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c =>
        c.importer_name?.toLowerCase().includes(q) ||
        c.sector?.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return sort === "newest" ? diff : -diff;
    });
    return list;
  }, [cases, filter, search, sort]);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems   = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function handleFilter(f: FilterMode) { setFilter(f); setPage(1); }
  function handleSort(s: SortOrder)    { setSort(s);   setPage(1); }
  function handleSearch(q: string)     { setSearch(q); setPage(1); }


  return (
    <div>

      {/* ── Section 1: Exposure number — full-width white surface ── */}
      <div style={{ backgroundColor: "var(--color-surface)", borderBottom: "var(--border-width) solid var(--color-border)" }}>
        <div
          className="page-content"
          style={{
            paddingTop:    "var(--space-40)",
            paddingBottom: "var(--space-40)",
          }}
        >
          <p
            style={{
              fontSize:     "var(--text-sm)",
              fontWeight:   "var(--font-body)",
              color:        "var(--color-text-secondary)",
              marginBottom: "var(--space-8)",
            }}
          >
            Estimated CBAM liability
          </p>

          {isLoading ? (
            <Skeleton height={52} width={200} />
          ) : (
            <p
              style={{
                fontSize:           "var(--text-hero)",
                fontWeight:         "var(--font-focal)",
                color:              "var(--color-navy)",
                letterSpacing:      "var(--tracking-hero)",
                fontVariantNumeric: "tabular-nums",
                lineHeight:         "var(--leading-display)",
              }}
            >
              {totalLiability != null ? formatCurrency(totalLiability) : "£0.00"}
            </p>
          )}

          <p style={{ fontSize: "var(--text-xs)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginTop: "var(--space-8)" }}>
            {isLoading
              ? "—"
              : `across ${cases.length} case${cases.length !== 1 ? "s" : ""}${lastUpdated ? ` · updated ${relativeTime(lastUpdated)}` : ""}`
            }
          </p>
        </div>
      </div>

      {/* ── Section 2: Pending review alert (only when cases need action) ── */}
      {!isLoading && hasPendingReview && (
        <div className="page-content" style={{ paddingTop: "var(--space-32)" }}>
          <div
            style={{
              display:         "flex",
              alignItems:      "center",
              justifyContent:  "space-between",
              gap:             "var(--space-24)",
              padding:         "var(--space-24) var(--space-32)",
              backgroundColor: "var(--color-surface)",
              border:          "var(--border-width) solid var(--color-border)",
              borderLeft:      "3px solid var(--color-amber)",
              borderRadius:    "0 var(--btn-radius) var(--btn-radius) 0",
            }}
          >
            <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-primary)" }}>
              {pendingReview.length} case{pendingReview.length > 1 ? "s" : ""} require human review before submission.
            </p>
            <Link
              href="/review"
              style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", whiteSpace: "nowrap" }}
            >
              Review now →
            </Link>
          </div>
        </div>
      )}

      {/* ── Section 3: Controls + case list ── */}
      <div className="page-content" style={{ paddingTop: "var(--space-32)", paddingBottom: "var(--space-64)" }}>

        {!isLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", marginBottom: "var(--space-24)", flexWrap: "wrap" }}>
            <IconDropdown
              icon={SlidersHorizontal}
              value={filter}
              options={[
                { value: "all",       label: "All cases"  },
                { value: "processed", label: "Processed"  },
                { value: "error",     label: "Error"      },
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

            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position:      "absolute",
                  left:          "10px",
                  top:           "50%",
                  transform:     "translateY(-50%)",
                  color:         "var(--color-text-tertiary)",
                  pointerEvents: "none",
                }}
              />
              <input
                type="search"
                placeholder="Search cases…"
                value={search}
                onChange={e => handleSearch(e.target.value)}
                style={{
                  height:          "32px",
                  width:           "220px",
                  paddingLeft:     "30px",
                  paddingRight:    "var(--space-12)",
                  fontSize:        "var(--text-sm)",
                  fontWeight:      300,
                  fontFamily:      "inherit",
                  color:           "var(--color-text-primary)",
                  backgroundColor: "var(--color-surface)",
                  border:          "var(--border-width) solid var(--color-border)",
                  borderRadius:    "6px",
                  outline:         "none",
                }}
              />
            </div>

            <div style={{ flex: 1 }} />

            <Link
              href="/upload"
              style={{
                display:         "inline-flex",
                alignItems:      "center",
                justifyContent:  "center",
                height:          "32px",
                padding:         "0 var(--space-24)",
                backgroundColor: "var(--color-navy)",
                color:           "#FFFFFF",
                fontSize:        "var(--text-sm)",
                fontWeight:      500,
                fontFamily:      "inherit",
                textDecoration:  "none",
                borderRadius:    "6px",
                whiteSpace:      "nowrap",
              }}
            >
              Upload document
            </Link>
          </div>
        )}

        {isLoading ? (
          <div style={{ border: "var(--border-width) solid var(--color-border)", borderRadius: "8px", overflow: "hidden" }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                style={{
                  display:      "flex",
                  alignItems:   "center",
                  height:       "56px",
                  borderBottom: i < 4 ? "var(--border-width) solid var(--color-border)" : undefined,
                  gap:          "var(--space-24)",
                  padding:      "0 var(--space-24)",
                }}
              >
                <Skeleton height={13} width="40%" />
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
                  <Skeleton height={20} width={100} borderRadius={4} />
                  <Skeleton height={13} width={56} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
                  <Skeleton height={13} width={72} />
                  <Skeleton height={20} width={80} borderRadius={4} />
                </div>
              </div>
            ))}
          </div>
        ) : cases.length === 0 ? (
          <div style={{ paddingTop: "var(--space-64)", textAlign: "center" }}>
            <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
              No cases yet. Upload a supplier document to get started.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ paddingTop: "var(--space-48)", textAlign: "center" }}>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
              {search.trim() ? `No cases matching "${search.trim()}".` : `No ${filter} cases.`}
            </p>
          </div>
        ) : (
          <>
            <div style={{ border: "var(--border-width) solid var(--color-border)", borderRadius: "8px", overflow: "hidden" }}>
              {pageItems.map((c, i) => (
                <CaseRow key={c.id} c={c} isLast={i === pageItems.length - 1} />
              ))}
            </div>

            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-8)", marginTop: "var(--space-24)" }}>
                <button
                  onClick={() => currentPage > 1 && setPage(p => p - 1)}
                  disabled={currentPage === 1}
                  style={{ height: "32px", padding: "0 var(--space-12)", border: "var(--border-width) solid var(--color-border)", borderRadius: "6px", backgroundColor: "var(--color-surface)", color: "var(--color-text-secondary)", fontSize: "var(--text-sm)", fontFamily: "inherit", cursor: currentPage === 1 ? "default" : "pointer", opacity: currentPage === 1 ? 0.4 : 1 }}
                >
                  ←
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    style={{ width: "32px", height: "32px", border: "var(--border-width) solid var(--color-border)", borderRadius: "6px", backgroundColor: n === currentPage ? "var(--color-navy)" : "var(--color-surface)", color: n === currentPage ? "#fff" : "var(--color-text-secondary)", fontSize: "var(--text-sm)", fontFamily: "inherit", cursor: n === currentPage ? "default" : "pointer" }}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => currentPage < totalPages && setPage(p => p + 1)}
                  disabled={currentPage === totalPages}
                  style={{ height: "32px", padding: "0 var(--space-12)", border: "var(--border-width) solid var(--color-border)", borderRadius: "6px", backgroundColor: "var(--color-surface)", color: "var(--color-text-secondary)", fontSize: "var(--text-sm)", fontFamily: "inherit", cursor: currentPage === totalPages ? "default" : "pointer", opacity: currentPage === totalPages ? 0.4 : 1 }}
                >
                  →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Case row ──────────────────────────────────────────────────────────────────

interface CaseRowProps {
  c:       CaseListItem;
  isLast?: boolean;
}

function CaseRow({ c, isLast }: CaseRowProps) {
  const [hovered, setHovered] = useState(false);

  // Left: "[Sector] · [Country code]", falling back to importer_name · quarter if not enriched
  const sector  = c.sector ? sectorLabel(c.sector) : c.importer_name;
  const country = c.sector && c.origin_country
    ? c.origin_country.toUpperCase()
    : `Q${c.reporting_quarter} ${c.reporting_year}`;
  const leftLabel = `${sector} · ${country}`;

  const massLabel = c.total_net_mass_kg != null
    ? c.total_net_mass_kg >= 1000
      ? `${(c.total_net_mass_kg / 1000).toFixed(1)} t`
      : `${c.total_net_mass_kg.toFixed(0)} kg`
    : null;

  return (
    <Link
      href={`/cases/${c.id}`}
      style={{ display: "block", textDecoration: "none" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          display:         "flex",
          alignItems:      "center",
          gap:             "var(--space-24)",
          height:          "56px",
          padding:         "0 var(--space-24)",
          borderBottom:    isLast ? undefined : "var(--border-width) solid var(--color-border)",
          backgroundColor: hovered ? "var(--color-surface)" : "transparent",
          transition:      "background-color 100ms",
        }}
      >
        {/* LEFT — sector + country */}
        <p
          style={{
            flex:         1,
            fontSize:     "var(--text-base)",
            fontWeight:   "var(--font-body)",
            color:        "var(--color-text-primary)",
            margin:       0,
            overflow:     "hidden",
            textOverflow: "ellipsis",
            whiteSpace:   "nowrap",
          }}
        >
          {leftLabel}
        </p>

        {/* CENTRE — net mass + method badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-16)", flexShrink: 0 }}>
          {massLabel && (
            <span
              style={{
                fontSize:           "var(--text-sm)",
                fontWeight:         "var(--font-body)",
                color:              "var(--color-text-secondary)",
                whiteSpace:         "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {massLabel}
            </span>
          )}
          {c.predominant_method && (
            <Badge variant={methodBadgeVariant(c.predominant_method)}>
              {methodLabel(c.predominant_method)}
            </Badge>
          )}
        </div>

        {/* RIGHT — status */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0 }}>
          <Badge variant={toStatusVariant(c.status)}>
            {statusLabel(c.status)}
          </Badge>
        </div>
      </div>
    </Link>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div style={{ minHeight: "100vh", backgroundColor: "var(--color-bg)" }} />;
  if (!user)     return <PublicScopeChecker />;
  return <Dashboard />;
}
