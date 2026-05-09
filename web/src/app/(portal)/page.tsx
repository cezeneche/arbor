"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
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
import type { Case } from "@/lib/api/types";

// UK ETS Q1 2027 quarterly-average (mirrors backend public_tools.py constant)
const PAGE_SIZE = 20;

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

function sectorLabel(s: string | null | undefined): string {
  const map: Record<string, string> = {
    iron_steel:  "Iron & steel",
    aluminium:   "Aluminium",
    cement:      "Cement",
    fertilisers: "Fertilisers",
    hydrogen:    "Hydrogen",
    electricity: "Electricity",
  };
  return s ? (map[s] ?? s.replace(/_/g, " ")) : "—";
}

function isRegistered(): boolean {
  try {
    const raw = localStorage.getItem("nucleos_reg_state");
    if (!raw) return false;
    return JSON.parse(raw)?.hmrcSubmitted === true;
  } catch {
    return false;
  }
}

// ── Dashboard — authenticated state ───────────────────────────────────────────

// Extended case shape — list API may return enriched fields
type CaseListItem = Case & {
  sector?:                  string | null;
  origin_country?:          string | null;
  predominant_method?:      string | null;
  estimated_liability_gbp?: number | null;
};

function Dashboard() {
  const { cases: rawCases, isLoading } = useCases();
  const cases = rawCases as CaseListItem[];
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [registered, setRegistered] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Read registration state from localStorage (set by /registration page)
  useEffect(() => { setRegistered(isRegistered()); }, []);

  // Intersection observer — infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible((v) => v + PAGE_SIZE); },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [cases.length]);

  // Total estimated liability — summed from per-case estimated_liability_gbp when available
  const totalLiability = cases.length > 0 && cases.some((c) => c.estimated_liability_gbp != null)
    ? cases.reduce((sum, c) => sum + (c.estimated_liability_gbp ?? 0), 0)
    : null;

  // Most recent updated_at
  const lastUpdated =
    cases.length > 0
      ? cases.reduce((latest, c) => (c.updated_at > latest ? c.updated_at : latest), cases[0].updated_at)
      : null;

  // Highest-priority action — one card, one call to action
  const pendingReview = cases.filter((c) => c.review_status === "pending_review");
  let action: { text: string; linkText: string; href: string } | null = null;

  if (pendingReview.length > 0) {
    const n = pendingReview.length;
    action = {
      text:     `${n} case${n > 1 ? "s" : ""} require human review before submission.`,
      linkText: "Review now →",
      href:     "/review",
    };
  } else if (cases.length > 0 && !registered) {
    action = {
      text:     "Registration with HMRC is required before 31 January 2028.",
      linkText: "Start registration →",
      href:     "/registration",
    };
  }

  // Sort by estimated liability descending — highest exposure at top; no-liability cases last
  const sortedCases = [...cases].sort((a, b) => {
    const aL = a.estimated_liability_gbp ?? -Infinity;
    const bL = b.estimated_liability_gbp ?? -Infinity;
    return bL - aL;
  });

  return (
    <div>

      {/* ── Section 1: Exposure number — full-width white surface ── */}
      <div style={{ backgroundColor: "var(--color-surface)", borderBottom: "var(--border-width) solid var(--color-border)" }}>
        <div
          className="page-content"
          style={{
            display:        "flex",
            alignItems:     "flex-end",
            justifyContent: "space-between",
            paddingTop:     "var(--space-40)",
            paddingBottom:  "var(--space-40)",
          }}
        >
          {/* LEFT: label · figure · meta */}
          <div>
            <p
              style={{
                fontSize:     "var(--text-sm)",
                fontWeight:   "var(--font-body)",
                color:        "var(--color-text-secondary)",
                marginBottom: "var(--space-8)",
              }}
            >
              Estimated 2027 CBAM liability
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

            <p style={{ fontSize: "var(--text-xs)", fontWeight: "var(--font-body)", color: "var(--color-text-tertiary)", marginTop: "var(--space-8)" }}>
              {isLoading
                ? "—"
                : `across ${cases.length} case${cases.length !== 1 ? "s" : ""}${lastUpdated ? ` · updated ${relativeTime(lastUpdated)}` : ""}`
              }
            </p>
          </div>

          {/* RIGHT: status badge — empty when all clear */}
          {!isLoading && cases.length > 0 && !registered && (
            <span
              style={{
                display:         "inline-flex",
                alignItems:      "center",
                height:          "var(--space-32)",
                padding:         "0 var(--space-16)",
                borderRadius:    "var(--badge-radius)",
                fontSize:        "var(--badge-font-size)",
                fontWeight:      "var(--badge-font-weight)",
                backgroundColor: "var(--color-amber-bg)",
                color:           "var(--color-amber)",
                whiteSpace:      "nowrap",
                flexShrink:      0,
              }}
            >
              Registration required
            </span>
          )}
        </div>
      </div>

      {/* ── Section 2: Action card — highest-priority only ── */}
      {action && (
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
              {action.text}
            </p>
            <Link
              href={action.href}
              style={{
                fontSize:   "var(--text-base)",
                fontWeight: "var(--font-focal)",
                color:      "var(--color-navy)",
                whiteSpace: "nowrap",
              }}
            >
              {action.linkText}
            </Link>
          </div>
        </div>
      )}

      {/* ── Section 3: Case list ── */}
      <div className="page-content" style={{ paddingTop: "var(--space-32)", paddingBottom: "var(--space-64)" }}>

        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              style={{
                display:     "flex",
                alignItems:  "center",
                height:      "56px",
                borderTop:   i === 0 ? "var(--border-width) solid var(--color-border)" : undefined,
                borderBottom: "var(--border-width) solid var(--color-border)",
                gap:         "var(--space-24)",
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
          ))
        ) : cases.length === 0 ? (
          <div style={{ paddingTop: "var(--space-64)", textAlign: "center" }}>
            <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
              No cases yet.
            </p>
            <Link
              href="/upload"
              style={{
                display:         "inline-flex",
                alignItems:      "center",
                justifyContent:  "center",
                height:          "40px",
                padding:         "0 var(--space-24)",
                backgroundColor: "var(--color-navy)",
                color:           "#FFFFFF",
                fontSize:        "var(--text-base)",
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
        ) : (
          <>
            {sortedCases.slice(0, visible).map((c, i) => (
              <CaseRow key={c.id} c={c} isFirst={i === 0} />
            ))}
            {visible < sortedCases.length && (
              <div ref={sentinelRef} style={{ height: "1px" }} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Case row ──────────────────────────────────────────────────────────────────

interface CaseRowProps {
  c:        CaseListItem;
  isFirst?: boolean;
}

function CaseRow({ c, isFirst }: CaseRowProps) {
  const [hovered, setHovered] = useState(false);

  // Left: "[Sector] · [Country code]", falling back to importer_name · quarter if not enriched
  const sector  = c.sector ? sectorLabel(c.sector) : c.importer_name;
  const country = c.sector && c.origin_country
    ? c.origin_country.toUpperCase()
    : `Q${c.reporting_quarter} ${c.reporting_year}`;
  const leftLabel = `${sector} · ${country}`;

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
          borderTop:       isFirst ? "var(--border-width) solid var(--color-border)" : undefined,
          borderBottom:    "var(--border-width) solid var(--color-border)",
          backgroundColor: hovered ? "var(--color-surface)" : "transparent",
          transition:      "background-color 100ms",
        }}
      >
        {/* LEFT — what it is: flex:1 so it absorbs all remaining space */}
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

        {/* CENTRE — how it was calculated: method badge + case ID */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0 }}>
          {c.predominant_method && (
            <Badge variant={methodBadgeVariant(c.predominant_method)}>
              {methodLabel(c.predominant_method)}
            </Badge>
          )}
          <span
            style={{
              fontSize:           "var(--text-xs)",
              fontWeight:         "var(--font-body)",
              color:              "var(--color-text-tertiary)",
              whiteSpace:         "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {c.id.slice(0, 8)}
          </span>
        </div>

        {/* RIGHT — what it costs and where it stands */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0 }}>
          {c.estimated_liability_gbp != null && (
            <span
              style={{
                fontSize:           "var(--text-base)",
                fontWeight:         "var(--font-focal)",
                color:              "var(--color-navy)",
                whiteSpace:         "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatCurrency(c.estimated_liability_gbp)}
            </span>
          )}
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

  // Hold render until auth state is resolved — prevents unauthenticated flash
  if (isLoading) return null;
  if (!user)     return <PublicScopeChecker />;
  return <Dashboard />;
}
