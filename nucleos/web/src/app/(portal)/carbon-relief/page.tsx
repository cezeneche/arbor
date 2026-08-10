"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useCases, useCase } from "@/lib/hooks/useCases";
import { ledgerFetch } from "@/lib/api/client";
import { formatCurrency } from "@/lib/design-system";
import { sectorLabel } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import AlertBanner from "@/components/ui/AlertBanner";



interface CPRCalcResult {
  cpr_amount_gbp:             string;
  effective_carbon_price_gbp: string;
  cpr_raw_gbp:                string;
  cpr_capped:                 boolean;
  cbam_liability_gbp:         string;
  net_price_local:            string;
  warnings:                   string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CPR_ELIGIBLE = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI","FR","GR",
  "HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO",
  "SE","SI","SK",           // EU member states
  "NO","IS","LI",           // EEA
  "CH",                     // Swiss ETS (linked to EU ETS)
]);

const SCHEME_NAMES: Partial<Record<string, string>> = {
  CH: "Swiss Emissions Trading Scheme (Swiss ETS)",
};
const schemeName = (iso2: string) =>
  SCHEME_NAMES[iso2.toUpperCase()] ?? "EU Emissions Trading System (EU ETS)";

const currencyFor = (iso2: string) =>
  iso2.toUpperCase() === "CH" ? "CHF" : "EUR";

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

// ── Field label ───────────────────────────────────────────────────────────────

function FL({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize:     "var(--text-xs)",
      fontWeight:   300,
      color:        "var(--color-text-secondary)",
      marginBottom: "var(--space-8)",
      margin:       "0 0 var(--space-8)",
    }}>
      {children}
    </p>
  );
}

// ── Preview row ───────────────────────────────────────────────────────────────

function PreviewRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-secondary)" }}>
        {label}
      </span>
      <span style={{
        fontSize:           "var(--text-sm)",
        fontWeight:         highlight ? 500 : 300,
        color:              highlight ? "var(--color-navy)" : "var(--color-text-primary)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </div>
  );
}

// ── CPR Form (rendered only when a case is expanded) ─────────────────────────

function CaseCPRForm({
  caseId,
  originCountry,
  estimatedLiability,
}: {
  caseId:             string;
  originCountry:      string;
  estimatedLiability: number | null;
}) {
  const { case_, isLoading } = useCase(caseId);
  const currency     = currencyFor(originCountry);
  const cbamLiability = estimatedLiability ?? 0;

  const [goodsLineId,  setGoodsLineId]  = useState("");
  const [emissions,    setEmissions]    = useState("");
  const [price,        setPrice]        = useState("");
  const [allocs,       setAllocs]       = useState("0");
  const [rate,         setRate]         = useState("");
  const [rateLoading,  setRateLoading]  = useState(true);
  const [verifier,     setVerifier]     = useState("");
  const [verifierBody, setVerifierBody] = useState("");

  const [phase,        setPhase]        = useState<"form" | "preview" | "done">("form");
  const [loading,      setLoading]      = useState(false);
  const [result,       setResult]       = useState<CPRCalcResult | null>(null);
  const [errMsg,       setErrMsg]       = useState("");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");

  // Auto-select first goods line once case detail loads
  useEffect(() => {
    if (case_?.goods_lines?.[0] && !goodsLineId) {
      setGoodsLineId(case_.goods_lines[0].id);
    }
  }, [case_?.goods_lines, goodsLineId]);

  // Fetch HMRC reference exchange rate
  useEffect(() => {
    if ((currency as string) === "GBP") { setRate("1"); setRateLoading(false); return; }
    setRateLoading(true);
    ledgerFetch<{ rates: Array<{ rate: string }> }>(
      `/api/cbam/cpr/exchange-rates?currency=${currency}`
    )
      .then((d) => { if (d.rates?.[0]?.rate) setRate(String(d.rates[0].rate)); })
      .catch(() => {})
      .finally(() => setRateLoading(false));
  }, [currency]);

  async function handleCalculate() {
    setLoading(true);
    setErrMsg("");
    try {
      const r = await ledgerFetch<CPRCalcResult>(
        "/api/cbam/cpr/calculate",
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            verified_emissions_tco2e: parseFloat(emissions),
            carbon_price_local:       parseFloat(price),
            currency_code:            currency,
            free_allocations:         parseFloat(allocs || "0"),
            rebates:                  0,
            exchange_rate_to_gbp:     parseFloat(rate),
            cbam_liability_gbp:       cbamLiability,
          }),
        }
      );
      setResult(r);
      setPhase("preview");
    } catch {
      setErrMsg("Unable to calculate. Check your inputs and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    setLoading(true);
    setErrMsg("");
    try {
      await ledgerFetch(
        "/api/cbam/cpr/claims",
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            goods_line_id:               goodsLineId,
            origin_country_code:         originCountry.toUpperCase(),
            qualifying_scheme_name:      schemeName(originCountry),
            carbon_price_local_currency: parseFloat(price),
            local_currency_code:         currency,
            free_allocations_received:   parseFloat(allocs || "0"),
            rebates_received:            0,
            verified_emissions_tco2e:    parseFloat(emissions),
            exchange_rate_to_gbp:        parseFloat(rate),
            exchange_rate_date:          new Date().toISOString().slice(0, 10),
            cbam_liability_gbp:          cbamLiability,
            verifier_name:               verifier || null,
            verifier_accreditation_body: verifierBody || null,
          }),
        }
      );
      setPhase("done");
    } catch {
      setErrMsg("Unable to submit claim. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const sectionStyle: React.CSSProperties = {
    padding:         "var(--space-24) 0",
    borderTop:       "var(--border-width) solid var(--color-border)",
    backgroundColor: "var(--color-bg)",
  };

  if (isLoading) {
    return (
      <div style={sectionStyle}>
        <Skeleton height={13} width={240} />
      </div>
    );
  }

  async function handleVerificationUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !goodsLineId) return;
    setUploadStatus("uploading");
    try {
      const token = (() => {
        if (typeof document === "undefined") return "";
        const m = document.cookie.match(/cbam_token=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);
        try { return localStorage.getItem("cbam_token") ?? ""; } catch { return ""; }
      })();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api-proxy/ledger/api/cbam/cpr/upload-verification/${goodsLineId}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }
      );
      setUploadStatus(res.ok ? "done" : "error");
    } catch {
      setUploadStatus("error");
    }
  }

  if (phase === "done") {
    return (
      <div style={sectionStyle}>
        <p style={{ fontSize: "var(--text-base)", fontWeight: 500, color: "var(--color-green)", margin: "0 0 var(--space-8)" }}>
          Claim submitted.
        </p>
        <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-secondary)", margin: "0 0 var(--space-24)", lineHeight: 1.7 }}>
          Your carbon relief claim has been recorded and will reduce your HMRC return liability.
        </p>

        {/* GACI verification document upload */}
        <p style={{ fontSize: "var(--text-xs)", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
          Verification document
        </p>
        <p style={{ fontSize: "var(--text-xs)", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-16)", lineHeight: 1.6 }}>
          Upload the GACI-accredited verifier&apos;s report confirming the carbon price paid. Required before your return is submitted.
        </p>

        {uploadStatus === "done" ? (
          <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-green)" }}>
            Verification document uploaded.
          </p>
        ) : (
          <>
            <label
              style={{
                display:         "inline-flex",
                alignItems:      "center",
                justifyContent:  "center",
                height:          "40px",
                padding:         "0 var(--space-24)",
                backgroundColor: uploadStatus === "uploading" ? "var(--color-border)" : "var(--color-navy)",
                color:           "#FFFFFF",
                fontSize:        "var(--text-sm)",
                fontWeight:      500,
                fontFamily:      "inherit",
                borderRadius:    "6px",
                cursor:          uploadStatus === "uploading" ? "default" : "pointer",
                whiteSpace:      "nowrap" as const,
              }}
            >
              {uploadStatus === "uploading" ? "Uploading…" : "Upload verification document"}
              <input
                type="file"
                accept=".pdf"
                onChange={handleVerificationUpload}
                disabled={uploadStatus === "uploading"}
                style={{ display: "none" }}
              />
            </label>
            {uploadStatus === "error" && (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginTop: "var(--space-8)" }}>
                Upload failed. Please try again.
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  const goods_lines  = case_?.goods_lines ?? [];
  const netLiability = result
    ? Math.max(0, parseFloat(result.cbam_liability_gbp) - parseFloat(result.cpr_amount_gbp))
    : null;

  return (
    <div style={sectionStyle}>

      {phase === "form" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-16)", marginBottom: "var(--space-24)" }}>

            {goods_lines.length > 1 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <FL>Goods line</FL>
                <select
                  value={goodsLineId}
                  onChange={(e) => setGoodsLineId(e.target.value)}
                  style={{ ...inputBase, cursor: "pointer" }}
                >
                  {goods_lines.map((gl) => (
                    <option key={gl.id} value={gl.id}>
                      {gl.cn_code} · {gl.description || gl.sector}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <FL>Verified emissions (tCO₂e)</FL>
              <input
                type="number" min={0} step="0.01"
                value={emissions}
                onChange={(e) => setEmissions(e.target.value)}
                placeholder="e.g. 12.50"
                style={inputBase}
              />
            </div>

            <div>
              <FL>Carbon price paid ({currency}/tCO₂e)</FL>
              <input
                type="number" min={0} step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={currency === "CHF" ? "e.g. 72.00" : "e.g. 65.00"}
                style={inputBase}
              />
            </div>

            <div>
              <FL>Free allocations received ({currency}/tCO₂e)</FL>
              <input
                type="number" min={0} step="0.01"
                value={allocs}
                onChange={(e) => setAllocs(e.target.value)}
                style={inputBase}
              />
            </div>

            <div>
              <FL>
                Exchange rate ({currency}→GBP)
                {rateLoading && (
                  <span style={{ color: "var(--color-text-tertiary)", marginLeft: 4 }}>
                    Fetching…
                  </span>
                )}
              </FL>
              <input
                type="number" min={0} step="0.0001"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="e.g. 0.8540"
                style={inputBase}
              />
            </div>
          </div>

          {errMsg && (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginBottom: "var(--space-16)" }}>
              {errMsg}
            </p>
          )}

          <Button
            variant="primary"
            disabled={loading || !emissions || !price || !rate || !goodsLineId}
            onClick={handleCalculate}
          >
            {loading ? "Calculating…" : "Calculate relief"}
          </Button>
        </>
      )}

      {phase === "preview" && result && (
        <>
          {/* Calculation breakdown */}
          <div style={{
            backgroundColor: "var(--color-surface)",
            border:          "var(--border-width) solid var(--color-border)",
            borderLeft:      "3px solid var(--color-navy)",
            borderRadius:    "0 8px 8px 0",
            padding:         "var(--space-24)",
            marginBottom:    "var(--space-24)",
          }}>
            <p style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-16)" }}>
              Calculation preview
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", marginBottom: "var(--space-16)" }}>
              <PreviewRow
                label={`Effective carbon price (${currency}→GBP)`}
                value={`£${parseFloat(result.effective_carbon_price_gbp).toFixed(4)}/tCO₂e`}
              />
              <PreviewRow
                label="Carbon relief (before cap)"
                value={formatCurrency(parseFloat(result.cpr_raw_gbp))}
              />
              <PreviewRow
                label="Carbon relief applied"
                value={formatCurrency(parseFloat(result.cpr_amount_gbp))}
                highlight
              />
              {result.cpr_capped && (
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-amber)", margin: "var(--space-4) 0 0" }}>
                  Relief capped at your estimated CBAM liability.
                </p>
              )}
            </div>
            <div style={{ height: "0.5px", backgroundColor: "var(--color-border)", margin: "var(--space-16) 0" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              <PreviewRow
                label="Estimated CBAM liability"
                value={formatCurrency(parseFloat(result.cbam_liability_gbp))}
              />
              <PreviewRow
                label="Net liability after relief"
                value={formatCurrency(netLiability ?? 0)}
                highlight
              />
            </div>
          </div>

          {/* Verifier details */}
          <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-16)", lineHeight: 1.7 }}>
            Carbon relief requires verification by a GACI-accredited verifier. Add their details now to make this claim HMRC-defensible, or leave blank and add later.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)", marginBottom: "var(--space-24)" }}>
            <input
              type="text"
              value={verifier}
              onChange={(e) => setVerifier(e.target.value)}
              placeholder="Verifier name (e.g. Bureau Veritas)"
              style={inputBase}
            />
            <input
              type="text"
              value={verifierBody}
              onChange={(e) => setVerifierBody(e.target.value)}
              placeholder="Accreditation body (e.g. UKAS, DAkkS, COFRAC)"
              style={inputBase}
            />
          </div>

          {errMsg && (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginBottom: "var(--space-16)" }}>
              {errMsg}
            </p>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-24)" }}>
            <Button variant="primary" disabled={loading} onClick={handleSubmit}>
              {loading ? "Submitting…" : "Submit claim"}
            </Button>
            <button
              onClick={() => { setPhase("form"); setResult(null); }}
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                fontSize: "var(--text-sm)", fontWeight: 300, fontFamily: "inherit",
                color: "var(--color-text-secondary)",
              }}
            >
              Edit inputs
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CarbonReliefPage() {
  const { cases, isLoading } = useCases();
  const [expanded, setExpanded] = useState<string | null>(null);

  const qualifying = cases.filter(
    (c) => c.origin_country && CPR_ELIGIBLE.has(c.origin_country.toUpperCase())
  );

  return (
    <div className="page-content" style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}>

      <h1 style={{
        fontSize:     "var(--text-lg)",
        fontWeight:   300,
        color:        "var(--color-text-primary)",
        marginBottom: "var(--space-8)",
      }}>
        Carbon relief
      </h1>
      <p style={{
        fontSize:     "var(--text-base)",
        fontWeight:   300,
        color:        "var(--color-text-secondary)",
        lineHeight:   1.7,
        marginBottom: "var(--space-24)",
      }}>
        Goods produced in EU member states, Norway, Iceland, Liechtenstein or Switzerland
        with a qualifying carbon price are eligible. Deduct the carbon price already paid
        from your UK CBAM liability, reducing it close to zero for large EU importers.
      </p>

      <AlertBanner message="The CBAM liability shown below uses a placeholder UK CBAM rate. HMRC has not published official quarterly rates yet. Relief calculations will update when official rates are published, expected Q4 2026." />

      {isLoading ? (
        Array.from({ length: 2 }).map((_, i) => (
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
            <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-16)" }}>
              <Skeleton height={13} width={80} />
              <Skeleton height={13} width={80} />
            </div>
          </div>
        ))
      ) : qualifying.length === 0 ? (
        <div style={{ paddingTop: "var(--space-64)", textAlign: "center" }}>
          <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
            No qualifying cases yet.
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
        qualifying.map((c, i) => {
          const label   = c.sector ? sectorLabel(c.sector) : c.importer_name;
          const country = c.origin_country?.toUpperCase() ?? "";
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
                  {label} · {country}
                </p>

                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-16)", flexShrink: 0 }}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                    style={{
                      background: "none", border: "none", padding: 0, cursor: "pointer",
                      fontSize:   "var(--text-sm)", fontWeight: 300, fontFamily: "inherit",
                      color:      "var(--color-navy)", whiteSpace: "nowrap",
                    }}
                  >
                    {isOpen ? "Close" : "Claim relief →"}
                  </button>
                </div>
              </div>

              {/* Expanded form */}
              {isOpen && c.origin_country && (
                <CaseCPRForm
                  caseId={c.id}
                  originCountry={c.origin_country}
                  estimatedLiability={c.estimated_liability_gbp ?? null}
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
