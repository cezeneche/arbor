"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const API_BASE = "/api-proxy/ledger";

interface ProductionRoute {
  key:   string;
  label: string;
}

interface FormContext {
  cn_code:           string;
  sector:            string;
  description:       string | null;
  installation_name: string | null;
  origin_country:    string | null;
  importer_name:     string | null;
  reporting_year:    number;
  production_routes: ProductionRoute[];
  expires_at:        string;
}

type PageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; ctx: FormContext }
  | { status: "submitted" };

const inputStyle: React.CSSProperties = {
  display:         "block",
  width:           "100%",
  height:          "var(--input-height)",
  padding:         "0 var(--space-16)",
  fontSize:        "var(--text-base)",
  fontWeight:      "var(--font-body)",
  fontFamily:      "inherit",
  color:           "var(--color-text-primary)",
  backgroundColor: "var(--color-surface)",
  border:          "var(--border-width) solid var(--color-border)",
  borderRadius:    "var(--input-radius)",
  outline:         "none",
  boxSizing:       "border-box",
};

const labelStyle: React.CSSProperties = {
  display:      "block",
  fontSize:     "var(--text-sm)",
  fontWeight:   "var(--font-focal)",
  color:        "var(--color-text-primary)",
  marginBottom: "var(--space-8)",
};

export default function SupplierFormPage({
  params,
}: {
  params: { token: string };
}) {
  const { token } = params;

  const [page,       setPage]       = useState<PageState>({ status: "loading" });
  const [see,        setSee]        = useState("");
  const [route,      setRoute]      = useState("");
  const [facility,   setFacility]   = useState("");
  const [seeError,   setSeeError]   = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/supplier-form/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail ?? "This link is invalid or has expired.");
        }
        return r.json() as Promise<FormContext>;
      })
      .then((ctx) => {
        setPage({ status: "ready", ctx });
        setFacility(ctx.installation_name ?? "");
        if (ctx.production_routes.length > 0) setRoute(ctx.production_routes[0].key);
      })
      .catch((e: Error) => setPage({ status: "error", message: e.message }));
  }, [token]);

  async function handleSubmit() {
    const seeNum = parseFloat(see);
    if (!see || isNaN(seeNum) || seeNum <= 0) {
      setSeeError("Enter a positive number for specific embedded emissions.");
      return;
    }
    setSeeError("");
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/public/supplier-form/${token}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          see_tco2e_per_t:   seeNum,
          production_route:  route || null,
          installation_name: facility.trim() || null,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail ?? "Submission failed. Please try again.");
      }
      setPage({ status: "submitted" });
    } catch (e) {
      setSeeError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight:       "100vh",
      backgroundColor: "var(--color-bg)",
      display:         "flex",
      justifyContent:  "center",
      padding:         "var(--space-64) var(--space-24) var(--space-80)",
    }}>
      <div style={{ width: "100%", maxWidth: 520 }}>

        {/* Wordmark */}
        <p style={{
          fontSize:      "20px",
          fontWeight:    "var(--font-focal)",
          color:         "var(--color-text-primary)",
          letterSpacing: "-0.03em",
          lineHeight:    1,
          marginBottom:  "var(--space-48)",
        }}>
          nucleos
        </p>

        {page.status === "loading" && (
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            Loading…
          </p>
        )}

        {page.status === "error" && (
          <>
            <h1 style={{ fontSize: "var(--text-lg)", marginBottom: "var(--space-16)" }}>
              Link unavailable
            </h1>
            <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
              {page.message}
            </p>
          </>
        )}

        {page.status === "submitted" && (
          <>
            <h1 style={{ fontSize: "var(--text-lg)", marginBottom: "var(--space-16)" }}>
              Data received.
            </h1>
            <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
              Your emissions data has been submitted. The importer will use it to
              calculate their CBAM liability. No further action is needed from you.
            </p>
          </>
        )}

        {page.status === "ready" && (() => {
          const { ctx } = page;
          return (
            <>
              {/* Header */}
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
                Request from{" "}
                <span style={{ fontWeight: "var(--font-focal)", color: "var(--color-text-primary)" }}>
                  {ctx.importer_name ?? "an importer"}
                </span>
              </p>
              <h1 style={{ fontSize: "var(--text-lg)", marginBottom: "var(--space-8)" }}>
                Emissions data request
              </h1>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", marginBottom: "var(--space-40)" }}>
                CN {ctx.cn_code}
                {ctx.description ? ` — ${ctx.description}` : ""}
                {ctx.origin_country ? ` · ${ctx.origin_country.toUpperCase()}` : ""}
                {" · "}{ctx.reporting_year}
              </p>

              {/* Context strip */}
              <div style={{
                backgroundColor: "var(--color-surface)",
                border:          "var(--border-width) solid var(--color-border)",
                borderRadius:    "var(--card-radius)",
                padding:         "var(--space-16) var(--space-24)",
                marginBottom:    "var(--space-32)",
              }}>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  Please submit the direct specific embedded emissions (SEE) for your
                  facility&apos;s production of this product. The data will be used for
                  UK CBAM compliance reporting under Finance No.2 Bill 2025-26.
                </p>
              </div>

              {/* Form fields */}
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-24)", marginBottom: "var(--space-32)" }}>

                {/* SEE */}
                <div>
                  <label style={labelStyle}>
                    Direct specific embedded emissions (SEE)
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="number"
                      step="0.001"
                      min="0.001"
                      value={see}
                      onChange={(e) => { setSee(e.target.value); setSeeError(""); }}
                      placeholder="e.g. 1.850"
                      style={{
                        ...inputStyle,
                        paddingRight: "var(--space-64)",
                        border: seeError
                          ? "var(--border-width) solid var(--color-red)"
                          : "var(--border-width) solid var(--color-border)",
                      }}
                    />
                    <span style={{
                      position:      "absolute",
                      right:         "var(--space-16)",
                      top:           "50%",
                      transform:     "translateY(-50%)",
                      fontSize:      "var(--text-xs)",
                      color:         "var(--color-text-tertiary)",
                      pointerEvents: "none",
                      whiteSpace:    "nowrap",
                    }}>
                      tCO₂e / t
                    </span>
                  </div>
                  {seeError ? (
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--color-red)", marginTop: "var(--space-8)" }}>
                      {seeError}
                    </p>
                  ) : (
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: "var(--space-8)", lineHeight: 1.5 }}>
                      Direct (Scope 1) emissions only. Do not include indirect electricity-related emissions.
                    </p>
                  )}
                </div>

                {/* Production route */}
                {ctx.production_routes.length > 0 && (
                  <div>
                    <label style={labelStyle}>
                      Production route
                    </label>
                    <div style={{ position: "relative" }}>
                      <select
                        value={route}
                        onChange={(e) => setRoute(e.target.value)}
                        style={{
                          ...inputStyle,
                          paddingRight: "var(--space-40)",
                          appearance:   "none",
                          cursor:       "pointer",
                        }}
                      >
                        {ctx.production_routes.map((r) => (
                          <option key={r.key} value={r.key}>{r.label}</option>
                        ))}
                      </select>
                      <svg
                        style={{ position: "absolute", right: "var(--space-16)", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                        width="14" height="14" viewBox="0 0 14 14" fill="none"
                      >
                        <path d="M3 5l4 4 4-4" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                )}

                {/* Facility name */}
                <div>
                  <label style={labelStyle}>
                    Facility / installation name
                  </label>
                  <input
                    type="text"
                    value={facility}
                    onChange={(e) => setFacility(e.target.value)}
                    placeholder="e.g. Steelworks Gdańsk, Plant 3"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Submit */}
              <Button
                variant="primary"
                loading={submitting}
                onClick={handleSubmit}
              >
                Submit emissions data
              </Button>

              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: "var(--space-16)", lineHeight: 1.6 }}>
                Retained for 6 years under UK CBAM record-keeping obligations
                (Finance No.2 Bill 2025-26). Not shared with any third party.
              </p>
            </>
          );
        })()}

      </div>
    </div>
  );
}
