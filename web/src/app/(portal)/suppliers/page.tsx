"use client";

import { useState, useEffect, Suspense } from "react";
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
  currentState?: string;
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
      {currentState && (
        <p style={{
          fontSize:   "var(--text-xs)",
          fontWeight: 300,
          color:      "var(--color-text-tertiary)",
          lineHeight: 1.5,
          margin:     0,
        }}>
          {currentState}
        </p>
      )}
    </button>
  );
}

// ── Per-case data request form ────────────────────────────────────────────────

function CaseRequestForm({ caseId }: { caseId: string }) {
  const { case_, isLoading } = useCase(caseId);
  const [path, setPath] = useState<DataPath>(null);

  const [lookupResult,  setLookupResult]  = useState<ScopeResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const [supplierEmail, setSupplierEmail] = useState("");
  const [formUrl,       setFormUrl]       = useState<string | null>(null);
  const [emailSent,     setEmailSent]     = useState(false);
  const [tokenLoading,  setTokenLoading]  = useState(false);
  const [tokenError,    setTokenError]    = useState<string | null>(null);
  const [copied,        setCopied]        = useState(false);

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
      const data = await ledgerFetch<{ form_url: string; email_sent: boolean }>(
        `/api/cbam/goods-lines/${firstLine.id}/supplier-token`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setFormUrl(data.form_url);
    } catch (e) {
      setTokenError((e as Error).message ?? "Failed to generate link.");
    } finally {
      setTokenLoading(false);
    }
  }

  async function handleSendToSupplier() {
    if (!firstLine?.id || !supplierEmail.trim()) return;
    setTokenLoading(true);
    setTokenError(null);
    try {
      const data = await ledgerFetch<{ form_url: string; email_sent: boolean }>(
        `/api/cbam/goods-lines/${firstLine.id}/supplier-token`,
        {
          method:  "POST",
          body:    JSON.stringify({ supplier_email: supplierEmail.trim() }),
        },
      );
      setFormUrl(data.form_url);
      setEmailSent(data.email_sent);
    } catch (e) {
      setTokenError((e as Error).message ?? "Failed to send — please try again.");
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
        />
        <PathCard
          selected={path === "supplier"}
          onClick={() => setPath(path === "supplier" ? null : "supplier")}
          title="Supplier form"
          body="Generate a secure one-time link. Your supplier opens it, fills in their emissions data, and it lands directly in this case, no login required."
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
          {emailSent ? (
            <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-16)", lineHeight: 1.6 }}>
              Link sent to <strong style={{ fontWeight: 500 }}>{supplierEmail}</strong>. When they submit, the data will appear in this case automatically.
            </p>
          ) : (
            <>
              <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-16)", lineHeight: 1.6 }}>
                Enter the email address of whoever handles CBAM or emissions reporting at the installation. They will receive a secure link, no account required.
              </p>
              <div style={{ display: "flex", gap: "var(--space-8)", marginBottom: tokenError ? "var(--space-8)" : "var(--space-16)", alignItems: "stretch" }}>
                <input
                  type="email"
                  placeholder="supplier@installation.com"
                  value={supplierEmail}
                  onChange={(e) => setSupplierEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendToSupplier()}
                  style={{
                    flex:            1,
                    height:          "40px",
                    padding:         "0 var(--space-16)",
                    fontSize:        "var(--text-sm)",
                    fontWeight:      300,
                    fontFamily:      "inherit",
                    color:           "var(--color-text-primary)",
                    backgroundColor: "var(--color-bg)",
                    border:          "var(--border-width) solid var(--color-border)",
                    borderRadius:    "6px",
                    outline:         "none",
                  }}
                />
                <Button
                  variant="primary"
                  loading={tokenLoading}
                  onClick={handleSendToSupplier}
                  disabled={!supplierEmail.trim()}
                >
                  Send to supplier
                </Button>
              </div>
              {tokenError && (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginBottom: "var(--space-16)" }}>
                  {tokenError}
                </p>
              )}
            </>
          )}
          <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
            {emailSent ? "Or copy the link to share another way" : "Prefer to share the link yourself?"}
          </p>
          {formUrl ? (
            <div>
              <div style={{
                display:         "flex",
                alignItems:      "center",
                gap:             "var(--space-16)",
                padding:         "0 var(--space-16)",
                height:          "40px",
                backgroundColor: "var(--color-surface)",
                border:          "var(--border-width) solid var(--color-border)",
                borderRadius:    "6px",
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
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    fontSize: "var(--text-sm)", fontWeight: 300, fontFamily: "inherit",
                    color: copied ? "var(--color-green)" : "var(--color-navy)",
                    whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <button
                onClick={() => { setFormUrl(null); setEmailSent(false); setSupplierEmail(""); }}
                style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  fontSize: "var(--text-xs)", fontFamily: "inherit",
                  color: "var(--color-text-tertiary)", marginTop: "var(--space-8)",
                  textDecoration: "underline",
                }}
              >
                Generate new link
              </button>
            </div>
          ) : (
            <button
              onClick={handleGenerateLink}
              disabled={tokenLoading}
              style={{
                background:  "none",
                border:      "none",
                padding:     0,
                cursor:      tokenLoading ? "not-allowed" : "pointer",
                fontSize:    "var(--text-sm)",
                fontWeight:  300,
                fontFamily:  "inherit",
                color:       "var(--color-navy)",
                opacity:     tokenLoading ? 0.5 : 1,
                textDecoration: "underline",
              }}
            >
              Generate link
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function RequestDataPageInner() {
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

export default function RequestDataPage() {
  return (
    <Suspense>
      <RequestDataPageInner />
    </Suspense>
  );
}
