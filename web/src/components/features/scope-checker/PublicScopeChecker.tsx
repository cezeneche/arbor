"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/design-system";
import { UK_ETS_RATE, sectorLabel } from "@/lib/constants";

const LABEL: React.CSSProperties = {
  fontSize:     "11px",
  fontWeight:   300,
  color:        "var(--color-text-secondary)",
  marginBottom: "4px",
  display:      "block",
};

type ScopeResult = {
  in_scope:                 boolean;
  sector?:                  string | null;
  cn_description?:          string | null;
  registration_required?:   boolean;
  reason?:                  string;
  default_see_tco2e_per_t?: number | null;
};

export function PublicScopeChecker() {
  const [code,    setCode]    = useState("");
  const [qty,     setQty]     = useState("");
  const [phase,   setPhase]   = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result,  setResult]  = useState<ScopeResult | null>(null);
  const [visible, setVisible] = useState(false);
  const [errMsg,  setErrMsg]  = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [qtyErr,  setQtyErr]  = useState("");

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    const cn     = code.replace(/\D/g, "").slice(0, 8);
    const qtyNum = Number(qty);

    let valid = true;
    if (!cn) { setCodeErr("Enter a commodity code"); valid = false; }
    else       setCodeErr("");
    if (qty.trim() && qtyNum < 1) { setQtyErr("Enter a quantity above zero"); valid = false; }
    else                            setQtyErr("");
    if (!valid) return;

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

  const qtyNum = Number(qty) || 0;
  const liabilityPerTonne =
    result?.default_see_tco2e_per_t != null
      ? result.default_see_tco2e_per_t * UK_ETS_RATE
      : null;
  const annualLiability =
    liabilityPerTonne != null && qtyNum > 0 ? liabilityPerTonne * qtyNum : null;
  const belowThreshold = result !== null && result.in_scope && annualLiability !== null && annualLiability < 50000;

  const inputStyle: React.CSSProperties = {
    flex:            1,
    height:          "100%",
    border:          "none",
    outline:         "none",
    fontSize:        "15px",
    fontWeight:      300,
    fontFamily:      "inherit",
    color:           "var(--color-text-primary)",
    backgroundColor: "transparent",
    minWidth:        0,
  };

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
      <style>{`
        .sc-row { display: flex; align-items: flex-end; }
        .sc-f1  { flex: 2; display: flex; flex-direction: column; min-width: 0; }
        .sc-f2  { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .sc-f1-box {
          display: flex; align-items: stretch; height: 40px;
          border: 0.5px solid var(--color-border);
          border-right: none;
          border-radius: 6px 0 0 6px;
          background: var(--color-surface); overflow: hidden;
        }
        .sc-f2-box {
          display: flex; align-items: stretch; height: 40px;
          border: 0.5px solid var(--color-border);
          border-radius: 0 6px 6px 0;
          background: var(--color-surface); overflow: hidden;
        }
        .sc-btn-mobile { display: none; }
        @media (max-width: 768px) {
          .sc-row { flex-direction: column; gap: 8px; }
          .sc-f1, .sc-f2 { flex: none; width: 100%; }
          .sc-f1-box { border-right: 0.5px solid var(--color-border); border-radius: 6px; }
          .sc-f2-box { border-radius: 6px; }
          .sc-btn-desktop { display: none !important; }
          .sc-btn-mobile  { display: flex; align-items: center; justify-content: center; }
        }
      `}</style>

      <div style={{ width: "100%", maxWidth: "640px" }}>

        {/* Wordmark */}
        <span
          style={{
            display:       "block",
            fontSize:      "15px",
            fontWeight:    500,
            color:         "var(--color-text-primary)",
            letterSpacing: "-0.03em",
            lineHeight:    1,
            fontFamily:    "inherit",
            marginBottom:  "var(--space-80)",
          }}
        >
          nucleos
        </span>

        <h1 style={{ fontSize: "var(--text-lg)", fontWeight: 500, color: "var(--color-text-primary)", margin: 0, marginBottom: "var(--space-24)" }}>
          Find out if your imports are subject to UK CBAM
        </h1>

        <form onSubmit={handleCheck} noValidate>
          <div className="sc-row">

            {/* Field 1 — Commodity code */}
            <div className="sc-f1">
              <span style={LABEL}>Commodity code</span>
              <div className="sc-f1-box">
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 8)); setCodeErr(""); }}
                  placeholder="e.g. 72082700"
                  autoComplete="off"
                  style={{ ...inputStyle, padding: "0 var(--space-16)" }}
                />
              </div>
              {codeErr && (
                <p style={{ fontSize: "13px", color: "var(--color-red)", margin: "4px 0 0" }}>
                  {codeErr}
                </p>
              )}
            </div>

            {/* Field 2 — Annual quantity + Check button */}
            <div className="sc-f2">
              <span style={LABEL}>Annual ton (optional)</span>
              <div className="sc-f2-box">
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => { setQty(e.target.value); setQtyErr(""); }}
                  placeholder="e.g. 500"
                  autoComplete="off"
                  style={{ ...inputStyle, padding: "0 var(--space-8) 0 var(--space-16)" }}
                />
                <span
                  style={{
                    fontSize:      "13px",
                    fontWeight:    300,
                    color:         "var(--color-text-tertiary)",
                    alignSelf:     "center",
                    paddingRight:  "8px",
                    flexShrink:    0,
                    pointerEvents: "none",
                    userSelect:    "none",
                  }}
                >
                  t
                </span>
                <div style={{ width: "0.5px", alignSelf: "stretch", backgroundColor: "var(--color-border)", flexShrink: 0 }} />
                {/* Check — desktop (embedded in field bar) */}
                <button
                  type="submit"
                  className="sc-btn-desktop"
                  style={{
                    height:          "100%",
                    padding:         "0 24px",
                    border:          "none",
                    outline:         "none",
                    backgroundColor: "var(--color-navy)",
                    fontSize:        "15px",
                    fontWeight:      500,
                    fontFamily:      "inherit",
                    color:           "#FFFFFF",
                    cursor:          phase === "loading" ? "default" : "pointer",
                    whiteSpace:      "nowrap",
                    flexShrink:      0,
                  }}
                >
                  {phase === "loading" ? "Checking…" : "Check"}
                </button>
              </div>
              {qtyErr && (
                <p style={{ fontSize: "13px", color: "var(--color-red)", margin: "4px 0 0" }}>
                  {qtyErr}
                </p>
              )}
            </div>
          </div>

          {/* Check — mobile only */}
          <button
            type="submit"
            className="sc-btn-mobile"
            style={{
              width:           "100%",
              height:          "40px",
              marginTop:       "8px",
              border:          "none",
              borderRadius:    "6px",
              backgroundColor: "var(--color-navy)",
              color:           "#FFFFFF",
              fontSize:        "15px",
              fontWeight:      500,
              fontFamily:      "inherit",
              cursor:          phase === "loading" ? "default" : "pointer",
            }}
          >
            {phase === "loading" ? "Checking…" : "Check"}
          </button>
        </form>

        {phase === "error" && (
          <p style={{ fontSize: "13px", color: "var(--color-red)", marginTop: "8px" }}>
            {errMsg}
          </p>
        )}

        {phase === "done" && result && (
          <div
            style={{
              opacity:    visible ? 1 : 0,
              transition: "opacity 150ms ease",
              marginTop:  "var(--space-24)",
            }}
          >
            {result.in_scope && !belowThreshold ? (
              <div
                style={{
                  backgroundColor: "var(--color-surface)",
                  border:          "0.5px solid var(--color-border)",
                  borderLeft:      "3px solid var(--color-navy)",
                  borderRadius:    "0 8px 8px 0",
                  padding:         "var(--space-24)",
                }}
              >
                <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-green)", marginBottom: "var(--space-16)" }}>
                  {qtyNum === 0 ? "In scope?" : "In scope"}
                </p>
                <p style={{ fontSize: "15px", fontWeight: 300, color: "var(--color-text-primary)", marginBottom: "var(--space-24)" }}>
                  {qtyNum === 0
                    ? "Enter your annual tonnage above to see whether you fall within scope and estimate your liability."
                    : `Your ${sectorLabel(result.sector).toLowerCase()} imports will be subject to UK CBAM from January 2027.`
                  }
                </p>

                {annualLiability != null ? (
                  <>
                    <p
                      style={{
                        fontSize:           "var(--text-hero)",
                        fontWeight:         500,
                        color:              "var(--color-navy)",
                        letterSpacing:      "-0.03em",
                        fontVariantNumeric: "tabular-nums",
                        lineHeight:         1.1,
                        marginBottom:       "8px",
                      }}
                    >
                      {formatCurrency(annualLiability)}
                    </p>
                    <p style={{ fontSize: "13px", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                      estimated annual liability across {qtyNum.toLocaleString("en-GB")} tonnes at default values
                    </p>
                  </>
                ) : qtyNum > 0 ? (
                  <p style={{ fontSize: "13px", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                    No default emissions rate available for this commodity code.
                  </p>
                ) : null}

                <div style={{ height: "0.5px", backgroundColor: "var(--color-border)", margin: "var(--space-24) 0" }} />

                <p style={{ fontSize: "13px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "var(--space-24)" }}>
                  UK CBAM applies if your annual imports of these goods exceed £50,000 in value. Below this threshold you will not be required to register.
                </p>

                <Link
                  href="/signup"
                  style={{ fontSize: "15px", fontWeight: 500, color: "var(--color-navy)" }}
                >
                  Get your exact figure →
                </Link>
              </div>
            ) : belowThreshold ? (
              <div
                style={{
                  backgroundColor: "var(--color-surface)",
                  border:          "0.5px solid var(--color-border)",
                  borderLeft:      "3px solid var(--color-green)",
                  borderRadius:    "0 8px 8px 0",
                  padding:         "var(--space-24)",
                }}
              >
                <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-green)", marginBottom: "var(--space-16)" }}>
                  Not in scope
                </p>
                <p style={{ fontSize: "15px", fontWeight: 300, color: "var(--color-text-primary)", marginBottom: "var(--space-24)" }}>
                  Your {sectorLabel(result.sector).toLowerCase()} imports will not be subject to UK CBAM from January 2027.
                </p>

                {annualLiability != null && (
                  <>
                    <p
                      style={{
                        fontSize:           "var(--text-hero)",
                        fontWeight:         500,
                        color:              "var(--color-navy)",
                        letterSpacing:      "-0.03em",
                        fontVariantNumeric: "tabular-nums",
                        lineHeight:         1.1,
                        marginBottom:       "8px",
                      }}
                    >
                      {formatCurrency(annualLiability)}
                    </p>
                    <p style={{ fontSize: "13px", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                      estimated annual liability across {qtyNum.toLocaleString("en-GB")} tonnes at default values
                    </p>
                  </>
                )}

                <div style={{ height: "0.5px", backgroundColor: "var(--color-border)", margin: "var(--space-24) 0" }} />

                <p style={{ fontSize: "13px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "var(--space-24)" }}>
                  UK CBAM applies if your annual imports of these goods exceed £50,000 in value. Below this threshold you will not be required to register.
                </p>

                <Link
                  href="/signup"
                  style={{ fontSize: "15px", fontWeight: 500, color: "var(--color-navy)" }}
                >
                  Get your exact figure →
                </Link>
              </div>
            ) : (
              <div
                style={{
                  backgroundColor: "var(--color-surface)",
                  border:          "0.5px solid var(--color-border)",
                  borderLeft:      "3px solid var(--color-green)",
                  borderRadius:    "0 8px 8px 0",
                  padding:         "var(--space-32)",
                }}
              >
                <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-green)", marginBottom: "8px" }}>
                  Not in scope
                </p>
                <p style={{ fontSize: "13px", fontWeight: 300, color: "var(--color-text-secondary)" }}>
                  {result.reason ?? `CN code ${code} is not covered by UK CBAM.`}{" "}
                  You will not be subject to UK CBAM from January 2027.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Sign in — always visible below all content */}
        <div style={{ marginTop: "var(--space-48)", textAlign: "center" }}>
          <Link
            href="/login"
            style={{
              fontSize:       "var(--text-base)",
              fontWeight:     500,
              color:          "var(--color-navy)",
              textDecoration: "none",
            }}
          >
            Sign in instead →
          </Link>
        </div>

      </div>
    </div>
  );
}
