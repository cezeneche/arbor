"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/useAuth";
import { useCases } from "@/lib/hooks/useCases";
import { useKPIs } from "@/lib/hooks/useInsights";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
  toStatusVariant,
  statusLabel,
  methodBadgeVariant,
  methodLabel,
} from "@/lib/design-system";
import type { Case } from "@/lib/api/types";

// UK ETS Q1 2027 quarterly-average (mirrors backend public_tools.py constant)
const UK_ETS_RATE = 52.4;
const PAGE_SIZE   = 20;

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

// ── Scope checker — unauthenticated state ─────────────────────────────────────

type ScopeResult = {
  in_scope:                boolean;
  sector?:                 string | null;
  cn_description?:         string | null;
  registration_required?:  boolean;
  reason?:                 string;
  default_see_tco2e_per_t?: number | null;
};

function ScopeChecker() {
  const [code,    setCode]    = useState("");
  const [phase,   setPhase]   = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result,  setResult]  = useState<ScopeResult | null>(null);
  const [visible, setVisible] = useState(false);
  const [errMsg,  setErrMsg]  = useState("");

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    const cn = code.replace(/\D/g, "").slice(0, 8);
    if (cn.length < 2) return;

    setPhase("loading");
    setVisible(false);
    setResult(null);

    try {
      const res = await fetch("/api-proxy/ledger/api/public/cbam-scope-check", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ cn8_code: cn, annual_import_value_gbp: 50000, regime: "UK" }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json() as ScopeResult;
      setResult(data);
      setPhase("done");
      requestAnimationFrame(() => setVisible(true));
    } catch {
      setPhase("error");
      setErrMsg("Unable to check. Please try again.");
    }
  }

  const liabilityPerTonne =
    result?.default_see_tco2e_per_t != null
      ? result.default_see_tco2e_per_t * UK_ETS_RATE
      : null;

  const cleanLen = code.replace(/\D/g, "").length;

  return (
    <div
      style={{
        minHeight:       "100vh",
        backgroundColor: "var(--color-bg)",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        padding:         "var(--space-32)",
      }}
    >
      <div style={{ width: "100%", maxWidth: "640px" }}>

        {/* Logotype */}
        <p
          style={{
            fontSize:     "var(--text-base)",
            fontWeight:   "var(--font-focal)",
            color:        "var(--color-text-primary)",
            marginBottom: "var(--space-80)",
          }}
        >
          Nucleos
        </p>

        {/* Heading */}
        <h1
          style={{
            fontSize:     "var(--text-lg)",
            fontWeight:   "var(--font-focal)",
            color:        "var(--color-text-primary)",
            marginBottom: "var(--space-24)",
          }}
        >
          Find out if your imports are subject to UK CBAM
        </h1>

        {/* Inline search — input + Check button as one element */}
        <form onSubmit={handleCheck}>
          <div
            style={{
              display:         "flex",
              alignItems:      "stretch",
              height:          "var(--btn-height)",
              border:          "var(--border-width) solid var(--color-border)",
              borderRadius:    "var(--btn-radius)",
              backgroundColor: "var(--color-surface)",
              overflow:        "hidden",
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="Enter commodity code e.g. 72082700"
              style={{
                flex:            1,
                height:          "100%",
                padding:         "0 var(--space-16)",
                border:          "none",
                outline:         "none",
                fontSize:        "var(--text-base)",
                fontWeight:      "var(--font-body)",
                fontFamily:      "inherit",
                color:           "var(--color-text-primary)",
                backgroundColor: "transparent",
              }}
            />
            {/* 0.5px vertical divider */}
            <div
              style={{
                width:           "var(--border-width)",
                alignSelf:       "stretch",
                backgroundColor: "var(--color-border)",
              }}
            />
            <button
              type="submit"
              disabled={cleanLen < 2 || phase === "loading"}
              style={{
                height:      "100%",
                padding:     "0 var(--space-24)",
                border:      "none",
                outline:     "none",
                background:  "none",
                fontSize:    "var(--text-base)",
                fontWeight:  "var(--font-focal)",
                fontFamily:  "inherit",
                color:       cleanLen < 2 || phase === "loading"
                               ? "var(--color-text-tertiary)"
                               : "var(--color-navy)",
                cursor:      cleanLen < 2 || phase === "loading" ? "default" : "pointer",
                whiteSpace:  "nowrap",
              }}
            >
              {phase === "loading" ? "Checking…" : "Check"}
            </button>
          </div>
        </form>

        {phase === "error" && (
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginTop: "var(--space-8)" }}>
            {errMsg}
          </p>
        )}

        {/* Result — fade in */}
        {phase === "done" && result && (
          <div
            style={{
              opacity:    visible ? 1 : 0,
              transition: "opacity 150ms ease",
              marginTop:  "var(--space-24)",
            }}
          >
            {result.in_scope ? (
              /* IN SCOPE — navy left border */
              <div
                style={{
                  backgroundColor: "var(--color-surface)",
                  border:          "var(--border-width) solid var(--color-border)",
                  borderLeft:      "3px solid var(--color-navy)",
                  borderRadius:    "0 var(--btn-radius) var(--btn-radius) 0",
                  padding:         "var(--space-32)",
                }}
              >
                <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-green)", marginBottom: "var(--space-8)" }}>
                  In scope
                </p>
                <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", marginBottom: "var(--space-8)" }}>
                  {sectorLabel(result.sector)}
                </p>
                {result.reason && (
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                    {result.reason}
                  </p>
                )}

                {liabilityPerTonne != null && (
                  <>
                    <p
                      style={{
                        fontSize:           "var(--text-hero)",
                        fontWeight:         "var(--font-focal)",
                        color:              "var(--color-navy)",
                        letterSpacing:      "var(--tracking-hero)",
                        fontVariantNumeric: "tabular-nums",
                        lineHeight:         "var(--leading-display)",
                        marginBottom:       "var(--space-8)",
                      }}
                    >
                      {formatCurrency(liabilityPerTonne)}
                    </p>
                    <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
                      estimated 2027 liability at default values · per tonne
                    </p>
                    <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                      Actual supplier data could reduce this by up to 30%.
                    </p>
                  </>
                )}

                <Link
                  href="/signup"
                  style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", color: "var(--color-navy)" }}
                >
                  Automate your compliance →
                </Link>
              </div>
            ) : (
              /* NOT IN SCOPE — green left border */
              <div
                style={{
                  backgroundColor: "var(--color-surface)",
                  border:          "var(--border-width) solid var(--color-border)",
                  borderLeft:      "3px solid var(--color-green)",
                  borderRadius:    "0 var(--btn-radius) var(--btn-radius) 0",
                  padding:         "var(--space-32)",
                }}
              >
                <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-green)", marginBottom: "var(--space-8)" }}>
                  Not in scope
                </p>
                <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
                  {result.reason ?? `CN code ${code} is not classified as a CBAM commodity under UK CBAM.`}
                </p>
              </div>
            )}

            {/* Already registered sign-in link */}
            <div style={{ marginTop: "var(--space-32)" }}>
              <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", marginBottom: "var(--space-16)" }} />
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                Already registered?{" "}
                <Link href="/login" style={{ color: "var(--color-text-secondary)", textDecoration: "underline" }}>
                  Sign in →
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard — authenticated state ───────────────────────────────────────────

function Dashboard() {
  const { user }              = useAuth();
  const { cases, isLoading }  = useCases();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [registered, setRegistered] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // EORI from first case → KPIs
  const eori = cases[0]?.importer_eori;
  const { kpis } = useKPIs(eori, 2027);

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

  // Total estimated liability
  const totalLiability =
    kpis?.estimated_cbam_cost != null  ? kpis.estimated_cbam_cost
    : kpis?.total_kgco2e != null       ? (kpis.total_kgco2e / 1000) * UK_ETS_RATE
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
                height:       "56px",
                borderBottom: "var(--border-width) solid var(--color-border)",
                display:      "flex",
                alignItems:   "center",
                gap:          "var(--space-24)",
              }}
            >
              <Skeleton height={14} width="45%" />
              <Skeleton height={14} width="15%" style={{ marginLeft: "auto" }} />
              <Skeleton height={22} width={72} borderRadius={4} />
            </div>
          ))
        ) : cases.length === 0 ? (
          <div style={{ paddingTop: "var(--space-64)" }}>
            <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
              No cases yet.{" "}
              <Link href="/upload" style={{ color: "var(--color-navy)" }}>
                Upload your first document →
              </Link>
            </p>
          </div>
        ) : (
          <>
            {cases.slice(0, visible).map((c) => (
              <CaseRow key={c.id} c={c} />
            ))}
            {visible < cases.length && (
              <div ref={sentinelRef} style={{ height: "1px" }} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Case row ──────────────────────────────────────────────────────────────────

// The list API returns base Case fields. sector/origin_country/predominant_method/
// estimated_liability_gbp are optional — displayed if present, gracefully hidden if not.
interface CaseRowProps {
  c: Case & {
    sector?:                  string | null;
    origin_country?:          string | null;
    predominant_method?:      string | null;
    estimated_liability_gbp?: number | null;
  };
}

function CaseRow({ c }: CaseRowProps) {
  const [hovered, setHovered] = useState(false);

  // Left label: sector · origin_country if available, else importer_name · period
  const leftPrimary = c.sector
    ? sectorLabel(c.sector)
    : c.importer_name;
  const leftSecondary = c.sector && c.origin_country
    ? c.origin_country.toUpperCase()
    : `Q${c.reporting_quarter} ${c.reporting_year}`;

  return (
    <Link
      href={`/cases/${c.id}`}
      style={{ display: "block", textDecoration: "none" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          display:             "grid",
          gridTemplateColumns: "1fr auto auto",
          alignItems:          "center",
          gap:                 "var(--space-24)",
          height:              "56px",
          padding:             "0 var(--space-8)",
          borderBottom:        "var(--border-width) solid var(--color-border)",
          backgroundColor:     hovered ? "var(--color-surface)" : "transparent",
          transition:          "background-color var(--transition-fast)",
        }}
      >
        {/* Left: primary label · secondary label */}
        <p
          style={{
            fontSize:     "var(--text-base)",
            fontWeight:   "var(--font-body)",
            color:        "var(--color-text-primary)",
            margin:       0,
            overflow:     "hidden",
            textOverflow: "ellipsis",
            whiteSpace:   "nowrap",
          }}
        >
          {leftPrimary}
          <span style={{ color: "var(--color-text-tertiary)" }}> · </span>
          <span style={{ color: "var(--color-text-secondary)" }}>{leftSecondary}</span>
        </p>

        {/* Centre: method badge (if available) + short case ID */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0 }}>
          {c.predominant_method && (
            <Badge variant={methodBadgeVariant(c.predominant_method)}>
              {methodLabel(c.predominant_method)}
            </Badge>
          )}
          <p
            style={{
              fontSize:           "var(--text-xs)",
              color:              "var(--color-text-tertiary)",
              margin:             0,
              whiteSpace:         "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {c.id.slice(0, 8)}
          </p>
        </div>

        {/* Right: liability (if available) + status badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0 }}>
          {c.estimated_liability_gbp != null && (
            <p
              style={{
                fontSize:           "var(--text-sm)",
                fontWeight:         "var(--font-body)",
                color:              "var(--color-text-secondary)",
                margin:             0,
                whiteSpace:         "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatCurrency(c.estimated_liability_gbp)}
            </p>
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
  if (!user)     return <ScopeChecker />;
  return <Dashboard />;
}
