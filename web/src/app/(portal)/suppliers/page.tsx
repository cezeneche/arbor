"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCases, useCase } from "@/lib/hooks/useCases";
import { ledgerFetch } from "@/lib/api/client";
import { formatCurrency } from "@/lib/design-system";
import { UK_ETS_RATE, sectorLabel } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { Case } from "@/lib/api/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type CaseRow = Case & {
  sector?:                  string | null;
  origin_country?:          string | null;
  estimated_liability_gbp?: number | null;
};

type DataPath = "lookup" | "supplier" | null;

interface ScopeResult {
  in_scope:                 boolean;
  sector?:                  string | null;
  cn_description?:          string | null;
  default_see_tco2e_per_t?: number | null;
}


// ── Path selector card ────────────────────────────────────────────────────────

function PathCard({
  selected,
  onClick,
  title,
  body,
  currentState,
}: {
  selected:     boolean;
  onClick:      () => void;
  title:        string;
  body:         string;
  currentState: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex:            1,
        textAlign:       "left",
        cursor:          "pointer",
        border:          "var(--border-width) solid var(--color-border)",
        borderLeft:      selected ? "3px solid var(--color-navy)" : "var(--border-width) solid var(--color-border)",
        borderRadius:    selected ? "0 8px 8px 0" : "8px",
        padding:         "var(--space-16) var(--space-24)",
        backgroundColor: selected ? "var(--color-surface)" : "var(--color-bg)",
        fontFamily:      "inherit",
        outline:         "none",
        transition:      "border-color 100ms, background-color 100ms",
      }}
    >
      <p style={{
        fontSize:     "var(--text-sm)",
        fontWeight:   500,
        color:        selected ? "var(--color-navy)" : "var(--color-text-primary)",
        marginBottom: "var(--space-8)",
      }}>
        {title}
      </p>
      <p style={{
        fontSize:     "var(--text-sm)",
        fontWeight:   300,
        color:        "var(--color-text-secondary)",
        lineHeight:   1.6,
        margin:       "0 0 var(--space-12)",
      }}>
        {body}
      </p>
      <p style={{
        fontSize:   "var(--text-xs)",
        fontWeight: 300,
        color:      "var(--color-text-tertiary)",
        lineHeight: 1.5,
        margin:     0,
      }}>
        {currentState}
      </p>
    </button>
  );
}

// ── Per-case data request form ────────────────────────────────────────────────

function CaseRequestForm({ caseId }: { caseId: string }) {
  const { case_, isLoading } = useCase(caseId);
  const [path, setPath] = useState<DataPath>(null);

  const [lookupResult,  setLookupResult]  = useState<ScopeResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const [formUrl,      setFormUrl]      = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError,   setTokenError]   = useState<string | null>(null);
  const [copied,       setCopied]       = useState(false);

  const firstLine = case_?.goods_lines?.[0];

  useEffect(() => {
    if (path !== "lookup" || !firstLine?.cn_code) return;
    setLookupLoading(true);
    fetch("/api-proxy/ledger/api/public/cbam-scope-check", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ cn8_code: firstLine.cn_code, annual_import_value_gbp: 50000, regime: "UK" }),
    })
      .then((r) => r.json())
      .then(setLookupResult)
      .catch(() => {})
      .finally(() => setLookupLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, firstLine?.cn_code]);

  async function handleGenerateLink() {
    if (!firstLine?.id) return;
    setTokenLoading(true);
    setTokenError(null);
    try {
      const data = await ledgerFetch<{ form_url: string }>(
        `/api/cbam/goods-lines/${firstLine.id}/supplier-token`,
        { method: "POST" },
      );
      setFormUrl(data.form_url);
    } catch (e) {
      setTokenError((e as Error).message ?? "Failed to generate link.");
    } finally {
      setTokenLoading(false);
    }
  }

  async function handleCopyLink() {
    if (!formUrl) return;
    try { await navigator.clipboard.writeText(formUrl); } catch { /* blocked */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const sectionStyle: React.CSSProperties = {
    padding:         "var(--space-24) 0",
    borderTop:       "var(--border-width) solid var(--color-border)",
    backgroundColor: "var(--color-bg)",
  };

  if (isLoading) {
    return (
      <div style={sectionStyle}>
        <Skeleton height={13} width={280} />
      </div>
    );
  }

  const see     = lookupResult?.default_see_tco2e_per_t;
  const estLiab = see != null ? see * UK_ETS_RATE * 1.2 : null;

  return (
    <div style={sectionStyle}>

      <div style={{ display: "flex", gap: "var(--space-16)", marginBottom: path ? "var(--space-24)" : 0 }}>
        <PathCard
          selected={path === "lookup"}
          onClick={() => setPath(path === "lookup" ? null : "lookup")}
          title="Known installation database"
          body="Check Annex VI reference values for this CN code. Shows the default that applies if supplier data is unavailable."
          currentState="Annex VI regulatory defaults. Per-installation EPD data coming later."
        />
        <PathCard
          selected={path === "supplier"}
          onClick={() => setPath(path === "supplier" ? null : "supplier")}
          title="Supplier form"
          body="Generate a secure one-time link. Your supplier opens it, fills in their emissions data, and it lands directly in this case — no login required."
          currentState="Supplier submits SEE, production route, and facility name. Data writes to the case as Tier 1 actual."
        />
      </div>

      {path === "lookup" && (
        <div style={{ marginTop: "var(--space-8)" }}>
          {lookupLoading ? (
            <Skeleton height={13} width={240} />
          ) : lookupResult?.in_scope && see != null ? (
            <>
              <div style={{
                backgroundColor: "var(--color-surface)",
                border:          "var(--border-width) solid var(--color-border)",
                borderRadius:    "8px",
                padding:         "var(--space-24)",
                marginBottom:    "var(--space-16)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-8)" }}>
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-secondary)" }}>
                    Annex VI default SEE
                  </span>
                  <span style={{ fontSize: "var(--text-base)", fontWeight: 500, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                    {see.toFixed(3)} tCO₂e/t
                  </span>
                </div>
                {estLiab != null && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-secondary)" }}>
                      Estimated per-tonne charge (2027, incl. 20% mark-up)
                    </span>
                    <span style={{ fontSize: "var(--text-base)", fontWeight: 500, color: "var(--color-navy)", fontVariantNumeric: "tabular-nums" }}>
                      {formatCurrency(estLiab)}/t
                    </span>
                  </div>
                )}
              </div>
              <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
                Actual data from your supplier removes the 20% mark-up and may lower your liability further depending on the production route.
              </p>
            </>
          ) : (
            <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-secondary)" }}>
              No reference value found for this commodity code.
            </p>
          )}
        </div>
      )}

      {path === "supplier" && (
        <div style={{ marginTop: "var(--space-8)" }}>
          {!formUrl ? (
            <>
              <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-16)", lineHeight: 1.6 }}>
                The link expires in 30 days and can only be used once. Share it with
                whoever handles CBAM or emissions reporting at the installation.
              </p>
              {tokenError && (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginBottom: "var(--space-16)" }}>
                  {tokenError}
                </p>
              )}
              <Button variant="primary" loading={tokenLoading} onClick={handleGenerateLink}>
                Generate secure link
              </Button>
            </>
          ) : (
            <>
              <p style={{ fontSize: "var(--text-xs)", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "var(--space-8)" }}>
                Supplier link — share this with your supplier
              </p>
              <div style={{
                display:         "flex",
                alignItems:      "center",
                gap:             "var(--space-16)",
                padding:         "0 var(--space-16)",
                height:          "40px",
                backgroundColor: "var(--color-surface)",
                border:          "var(--border-width) solid var(--color-border)",
                borderRadius:    "6px",
                marginBottom:    "var(--space-16)",
              }}>
                <span style={{
                  flex:         1,
                  fontSize:     "var(--text-sm)",
                  fontWeight:   300,
                  color:        "var(--color-text-secondary)",
                  overflow:     "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace:   "nowrap",
                  fontFamily:   "ui-monospace, 'SF Mono', Menlo, monospace",
                }}>
                  {formUrl}
                </span>
                <button
                  onClick={handleCopyLink}
                  style={{
                    background:  "none",
                    border:      "none",
                    padding:     0,
                    cursor:      "pointer",
                    fontSize:    "var(--text-sm)",
                    fontWeight:  300,
                    fontFamily:  "inherit",
                    color:       copied ? "var(--color-green)" : "var(--color-navy)",
                    whiteSpace:  "nowrap",
                    flexShrink:  0,
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p style={{ fontSize: "var(--text-xs)", fontWeight: 300, color: "var(--color-text-tertiary)", lineHeight: 1.5 }}>
                When your supplier submits, the data will appear in the case automatically.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RequestDataPage() {
  const { cases: raw, isLoading } = useCases();
  const cases = raw as CaseRow[];
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(searchParams.get("case") ?? null);

  return (
    <div className="page-content" style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}>

      <h1 style={{
        fontSize:     "var(--text-lg)",
        fontWeight:   300,
        color:        "var(--color-text-primary)",
        marginBottom: "var(--space-8)",
      }}>
        Emissions data
      </h1>
      <p style={{
        fontSize:     "var(--text-base)",
        fontWeight:   300,
        color:        "var(--color-text-secondary)",
        lineHeight:   1.7,
        marginBottom: "var(--space-40)",
      }}>
        Actual emissions figures avoid the 20% default value mark-up from 2027.
        Check our installation database or send your supplier a structured data request.
      </p>

      {isLoading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            style={{
              display:      "flex",
              alignItems:   "center",
              height:       56,
              borderTop:    i === 0 ? "var(--border-width) solid var(--color-border)" : undefined,
              borderBottom: "var(--border-width) solid var(--color-border)",
              gap:          "var(--space-24)",
            }}
          >
            <Skeleton height={13} width="40%" />
            <div style={{ marginLeft: "auto" }}>
              <Skeleton height={13} width={80} />
            </div>
          </div>
        ))
      ) : cases.length === 0 ? (
        <div style={{ paddingTop: "var(--space-64)", textAlign: "center" }}>
          <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
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
        cases.map((c, i) => {
          const label   = c.sector ? sectorLabel(c.sector) : c.importer_name;
          const country = c.origin_country ? ` · ${c.origin_country.toUpperCase()}` : "";
          const isOpen  = expanded === c.id;

          return (
            <div
              key={c.id}
              style={{
                borderTop:    i === 0 ? "var(--border-width) solid var(--color-border)" : undefined,
                borderBottom: "var(--border-width) solid var(--color-border)",
              }}
            >
              {/* Row */}
              <div style={{ display: "flex", alignItems: "center", height: 56, gap: "var(--space-24)" }}>
                <p style={{
                  flex:         1,
                  margin:       0,
                  fontSize:     "var(--text-base)",
                  fontWeight:   300,
                  color:        "var(--color-text-primary)",
                  overflow:     "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace:   "nowrap",
                }}>
                  {label}{country}
                </p>

                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-24)", flexShrink: 0 }}>
                  {c.estimated_liability_gbp != null && (
                    <span style={{
                      fontSize:           "var(--text-base)",
                      fontWeight:         500,
                      color:              "var(--color-navy)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {formatCurrency(c.estimated_liability_gbp)}
                    </span>
                  )}
                  <button
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                    style={{
                      background: "none", border: "none", padding: 0, cursor: "pointer",
                      fontSize:   "var(--text-sm)", fontWeight: 300, fontFamily: "inherit",
                      color:      "var(--color-navy)", whiteSpace: "nowrap",
                    }}
                  >
                    {isOpen ? "Close" : "Request data →"}
                  </button>
                </div>
              </div>

              {/* Expanded */}
              {isOpen && <CaseRequestForm caseId={c.id} />}
            </div>
          );
        })
      )}
    </div>
  );
}
