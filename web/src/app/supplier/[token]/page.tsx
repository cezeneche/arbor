"use client";

import { use, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

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
  height:          "40px",
  padding:         "0 16px",
  fontSize:        "15px",
  fontWeight:      300,
  fontFamily:      "inherit",
  color:           "var(--color-text-primary, #111)",
  backgroundColor: "#fff",
  border:          "0.5px solid #d0d5dd",
  borderRadius:    "6px",
  outline:         "none",
  boxSizing:       "border-box",
};

const labelStyle: React.CSSProperties = {
  display:      "block",
  fontSize:     "11px",
  fontWeight:   300,
  color:        "#6b7280",
  marginBottom: "6px",
};

export default function SupplierFormPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [page, setPage] = useState<PageState>({ status: "loading" });

  const [see,       setSee]       = useState("");
  const [route,     setRoute]     = useState("");
  const [facility,  setFacility]  = useState("");
  const [seeError,  setSeeError]  = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/public/supplier-form/${token}`)
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
      const r = await fetch(`${API}/api/public/supplier-form/${token}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          see_tco2e_per_t:   seeNum,
          production_route:  route,
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

  if (page.status === "loading") {
    return (
      <Shell>
        <p style={{ fontSize: "13px", color: "#6b7280" }}>Loading…</p>
      </Shell>
    );
  }

  if (page.status === "error") {
    return (
      <Shell>
        <p style={{ fontSize: "15px", color: "#d92d20", lineHeight: 1.6 }}>{page.message}</p>
      </Shell>
    );
  }

  if (page.status === "submitted") {
    return (
      <Shell>
        <p style={{ fontSize: "24px", fontWeight: 300, color: "#111", marginBottom: "16px" }}>
          Data received.
        </p>
        <p style={{ fontSize: "15px", fontWeight: 300, color: "#6b7280", lineHeight: 1.7 }}>
          Your emissions data has been submitted. The importer will use it to calculate
          their CBAM liability — no further action is needed from you.
        </p>
      </Shell>
    );
  }

  const { ctx } = page;

  return (
    <Shell>
      <p style={{ fontSize: "11px", color: "#6b7280", marginBottom: "32px" }}>
        {ctx.importer_name ?? "An importer"} has requested your facility&apos;s emissions
        data for UK CBAM compliance (Finance No.2 Bill 2025-26).
      </p>

      <h1 style={{ fontSize: "24px", fontWeight: 300, color: "#111", marginBottom: "8px" }}>
        Emissions data request
      </h1>
      <p style={{ fontSize: "13px", fontWeight: 300, color: "#6b7280", marginBottom: "32px", lineHeight: 1.6 }}>
        CN {ctx.cn_code}{ctx.description ? ` — ${ctx.description}` : ""}
        {ctx.origin_country ? ` · ${ctx.origin_country.toUpperCase()}` : ""}
      </p>

      <div style={{ marginBottom: "24px" }}>
        <label style={labelStyle}>
          Direct specific embedded emissions (tCO₂e per tonne of product)
        </label>
        <input
          type="number"
          step="0.001"
          min="0.001"
          value={see}
          onChange={(e) => { setSee(e.target.value); setSeeError(""); }}
          placeholder="e.g. 1.850"
          style={{ ...inputStyle, fontSize: "max(16px, 15px)" }}
        />
        {seeError && (
          <p style={{ fontSize: "13px", color: "#d92d20", marginTop: "6px" }}>{seeError}</p>
        )}
        <p style={{ fontSize: "11px", color: "#9ca3af", marginTop: "6px", lineHeight: 1.5 }}>
          Direct CO₂e emissions only — exclude electricity-related (indirect) emissions.
          If you file EU CBAM reports, use the same figure from your CBAM records.
        </p>
      </div>

      {ctx.production_routes.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <label style={labelStyle}>Production route</label>
          <select
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}
          >
            {ctx.production_routes.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </div>
      )}

      <div style={{ marginBottom: "32px" }}>
        <label style={labelStyle}>Facility / installation name</label>
        <input
          type="text"
          value={facility}
          onChange={(e) => setFacility(e.target.value)}
          style={inputStyle}
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          height:          "40px",
          padding:         "0 24px",
          backgroundColor: submitting ? "#93adc8" : "#1B2F4A",
          color:           "#fff",
          fontSize:        "15px",
          fontWeight:      300,
          fontFamily:      "inherit",
          border:          "none",
          borderRadius:    "6px",
          cursor:          submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Submitting…" : "Submit emissions data"}
      </button>

      <p style={{ fontSize: "11px", color: "#9ca3af", marginTop: "16px", lineHeight: 1.5 }}>
        Your data is retained for 6 years under UK CBAM record-keeping obligations
        (Finance No.2 Bill 2025-26). It will not be shared with any third party.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight:       "100vh",
        backgroundColor: "#f9fafb",
        display:         "flex",
        justifyContent:  "center",
        padding:         "64px 24px 80px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520 }}>
        <p style={{ fontSize: "13px", fontWeight: 300, color: "#1B2F4A", marginBottom: "40px" }}>
          nucleos
        </p>
        {children}
      </div>
    </div>
  );
}
