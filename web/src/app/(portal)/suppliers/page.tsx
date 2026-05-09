"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useCases, useCase } from "@/lib/hooks/useCases";
import { ledgerFetch } from "@/lib/api/client";
import { formatCurrency } from "@/lib/design-system";
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

interface LetterResult {
  email_subject:            string;
  email_text:               string;
  translation_recommended:  boolean;
  translation_language_hint: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const UK_ETS_RATE = 52.4;

const SECTOR: Record<string, string> = {
  iron_steel:  "Iron & steel", aluminium:   "Aluminium",
  cement:      "Cement",       fertilisers: "Fertilisers",
  hydrogen:    "Hydrogen",     electricity: "Electricity",
};

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputBase: React.CSSProperties = {
  width:           "100%",
  height:          "var(--input-height)",
  padding:         "0 var(--space-16)",
  fontSize:        "var(--text-base)",
  fontWeight:      300,
  fontFamily:      "inherit",
  color:           "var(--color-text-primary)",
  backgroundColor: "var(--color-surface)",
  border:          "var(--border-width) solid var(--color-border)",
  borderRadius:    "var(--input-radius)",
  outline:         "none",
  boxSizing:       "border-box" as const,
};

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

  // Lookup path state
  const [lookupResult,  setLookupResult]  = useState<ScopeResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Supplier path state
  const [supplierEmail,  setSupplierEmail]  = useState("");
  const [emailError,     setEmailError]     = useState("");
  const [letterSubject,  setLetterSubject]  = useState("");
  const [letterBody,     setLetterBody]     = useState("");
  const [letterLoading,  setLetterLoading]  = useState(false);
  const [translationHint, setTranslationHint] = useState<string | null>(null);
  const [sent,           setSent]           = useState(false);

  const firstLine = case_?.goods_lines?.[0];

  // Fetch reference value when lookup path is selected
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

  // Fetch backend-generated letter when supplier path is selected
  useEffect(() => {
    if (path !== "supplier" || !firstLine?.id) return;
    setLetterLoading(true);
    ledgerFetch<LetterResult>(
      `/api-proxy/ledger/api/cbam/goods-lines/${firstLine.id}/generate-supplier-request?format=email`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ jurisdiction: "UK" }),
      }
    )
      .then((d) => {
        setLetterSubject(d.email_subject);
        setLetterBody(d.email_text);
        if (d.translation_recommended && d.translation_language_hint) {
          setTranslationHint(d.translation_language_hint);
        }
      })
      .catch(() => {})
      .finally(() => setLetterLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, firstLine?.id]);

  function handleSend() {
    if (!supplierEmail.trim() || !supplierEmail.includes("@")) {
      setEmailError("Enter a valid supplier email address.");
      return;
    }
    setEmailError("");
    const mailto =
      `mailto:${encodeURIComponent(supplierEmail)}` +
      `?subject=${encodeURIComponent(letterSubject)}` +
      `&body=${encodeURIComponent(letterBody)}`;
    window.location.href = mailto;
    setSent(true);
  }

  async function handleCopy() {
    try { await navigator.clipboard.writeText(`Subject: ${letterSubject}\n\n${letterBody}`); }
    catch { /* blocked — fail silently */ }
    setSent(true);
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

  // Lookup path — reference value from Annex VI
  const see     = lookupResult?.default_see_tco2e_per_t;
  const estLiab = see != null ? see * UK_ETS_RATE * 1.2 : null; // 2027: +20% default mark-up

  return (
    <div style={sectionStyle}>

      {/* Path selector */}
      <div style={{ display: "flex", gap: "var(--space-16)", marginBottom: path ? "var(--space-24)" : 0 }}>
        <PathCard
          selected={path === "lookup"}
          onClick={() => setPath(path === "lookup" ? null : "lookup")}
          title="Known installation database"
          body="Check Annex VI reference values for this CN code. Shows the default that applies if supplier data is unavailable."
          currentState="Now: Annex VI regulatory defaults. Coming: per-installation EPD data from WorldSteel, European Aluminium, and national EPD programmes."
        />
        <PathCard
          selected={path === "supplier"}
          onClick={() => setPath(path === "supplier" ? null : "supplier")}
          title="Tokenized supplier form"
          body="Send a structured data request. If they file EU CBAM reports, this data already exists at their installation."
          currentState="Now: backend-generated email template with regulation references. Coming: no-login web form — supplier fills in directly, data lands in your case."
        />
      </div>

      {/* Lookup content */}
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

      {/* Supplier request content */}
      {path === "supplier" && (
        <div style={{ marginTop: "var(--space-8)" }}>
          {letterLoading ? (
            <Skeleton height={13} width={280} />
          ) : (
            <>
              {translationHint && (
                <p style={{
                  fontSize:     "var(--text-sm)",
                  fontWeight:   300,
                  color:        "var(--color-text-secondary)",
                  marginBottom: "var(--space-16)",
                  lineHeight:   1.6,
                }}>
                  Consider sending this in {translationHint} — your supplier may find it easier to respond in their language.
                </p>
              )}

              {/* Supplier email */}
              <div style={{ marginBottom: "var(--space-16)" }}>
                <p style={{ fontSize: "var(--text-xs)", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
                  Supplier email
                </p>
                <input
                  type="email"
                  value={supplierEmail}
                  onChange={(e) => { setSupplierEmail(e.target.value); setEmailError(""); }}
                  placeholder="supplier@example.com"
                  style={{ ...inputBase, fontSize: "max(16px, var(--text-base))" }}
                />
                {emailError && (
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginTop: "var(--space-8)" }}>
                    {emailError}
                  </p>
                )}
              </div>

              {/* Subject */}
              <p style={{ fontSize: "var(--text-xs)", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "var(--space-8)" }}>
                Subject: <span style={{ color: "var(--color-text-secondary)" }}>{letterSubject}</span>
              </p>

              {/* Letter body — editable */}
              <textarea
                value={letterBody}
                onChange={(e) => setLetterBody(e.target.value)}
                rows={18}
                style={{
                  width:           "100%",
                  padding:         "var(--space-24)",
                  fontSize:        "var(--text-sm)",
                  fontWeight:      300,
                  fontFamily:      "inherit",
                  lineHeight:      1.7,
                  color:           "var(--color-text-primary)",
                  backgroundColor: "var(--color-surface)",
                  border:          "var(--border-width) solid var(--color-border)",
                  borderRadius:    "8px",
                  outline:         "none",
                  resize:          "vertical",
                  boxSizing:       "border-box",
                  marginBottom:    "var(--space-16)",
                }}
              />

              {sent ? (
                <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-green)" }}>
                  Request sent.
                </p>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-24)" }}>
                  <Button variant="primary" onClick={handleSend}>
                    Send email
                  </Button>
                  <Button variant="secondary" onClick={handleCopy}>
                    Copy
                  </Button>
                </div>
              )}
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
  const [expanded, setExpanded] = useState<string | null>(null);

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
          const label   = c.sector ? (SECTOR[c.sector] ?? c.sector.replace(/_/g, " ")) : c.importer_name;
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
