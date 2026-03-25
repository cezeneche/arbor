"use client";

import { useState } from "react";
import { useCases } from "@/lib/hooks/useCases";
import { useKPIs, useSectorSummary, useCountryIntensity } from "@/lib/hooks/useInsights";
import { formatTco2e, formatGbp } from "@/lib/design-system";

const CURRENT_YEAR = new Date().getFullYear();

function methodBreakdownLabel(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => `${method} (${count})`)
    .join(", ");
  return entries || "—";
}

export default function InsightsPage() {
  const { cases, isLoading: casesLoading } = useCases();
  const [year, setYear] = useState<number>(CURRENT_YEAR);

  // Derive EORI from the first case (most importers have one EORI)
  const eori = cases[0]?.importer_eori;

  const { kpis, isLoading: kpisLoading, error: kpisError } = useKPIs(eori, year);
  const { sectors, isLoading: sectorsLoading } = useSectorSummary(eori);
  const { countries, isLoading: countriesLoading } = useCountryIntensity(eori);

  const isLoading = casesLoading || kpisLoading;

  return (
    <div className="page-content">
      {/* Header */}
      <div
        style={{
          display:        "flex",
          alignItems:     "baseline",
          justifyContent: "space-between",
          marginBottom:   "var(--space-32)",
        }}
      >
        <h1
          style={{
            fontSize:   "var(--text-lg)",
            fontWeight: "var(--font-focal)",
            color:      "var(--color-text-primary)",
          }}
        >
          Insights
        </h1>

        {/* Year selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <label
            htmlFor="year-select"
            style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}
          >
            Year
          </label>
          <select
            id="year-select"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{
              fontSize:        "var(--text-sm)",
              color:           "var(--color-text-primary)",
              border:          "var(--border-width) solid var(--color-border)",
              borderRadius:    "var(--input-radius)",
              background:      "var(--color-surface)",
              padding:         "6px var(--space-8)",
              fontFamily:      "inherit",
              cursor:          "pointer",
            }}
          >
            {[CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* No cases yet */}
      {!casesLoading && cases.length === 0 && (
        <div
          style={{
            paddingTop:    "var(--space-80)",
            paddingBottom: "var(--space-80)",
            textAlign:     "center",
          }}
        >
          <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>
            No data yet.
          </p>
          <p
            style={{
              fontSize:  "var(--text-sm)",
              color:     "var(--color-text-tertiary)",
              marginTop: "var(--space-8)",
            }}
          >
            Insights appear once you have at least one case.
          </p>
        </div>
      )}

      {isLoading && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          Loading…
        </p>
      )}

      {kpisError && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>
          {kpisError.message}
        </p>
      )}

      {/* KPI cards */}
      {kpis && (
        <>
          {/* Hero: total tCO₂e */}
          <div
            style={{
              marginBottom:    "var(--space-48)",
              paddingBottom:   "var(--space-48)",
              borderBottom:    "var(--border-width) solid var(--color-border)",
            }}
          >
            <p
              style={{
                fontSize:  "var(--text-sm)",
                color:     "var(--color-text-tertiary)",
                marginBottom: "var(--space-8)",
              }}
            >
              Total emissions {year}
            </p>
            <p
              style={{
                fontSize:      "var(--text-hero)",
                fontWeight:    "var(--font-focal)",
                color:         "var(--color-navy)",
                letterSpacing: "var(--tracking-hero)",
                lineHeight:    "var(--leading-display)",
              }}
            >
              {formatTco2e(kpis.total_kgco2e)}
            </p>
            {kpis.estimated_cbam_cost !== undefined && (
              <p
                style={{
                  fontSize:  "var(--text-base)",
                  color:     "var(--color-text-secondary)",
                  marginTop: "var(--space-8)",
                }}
              >
                Estimated CBAM cost: {formatGbp(kpis.estimated_cbam_cost)}
              </p>
            )}
          </div>

          {/* Secondary KPIs */}
          <div
            style={{
              display:             "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap:                 "var(--space-24)",
              marginBottom:        "var(--space-48)",
            }}
          >
            {[
              { label: "Cases", value: String(kpis.total_cases) },
              { label: "Direct emissions", value: formatTco2e(kpis.total_direct_kgco2e) },
              { label: "Indirect emissions", value: formatTco2e(kpis.total_indirect_kgco2e) },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  backgroundColor: "var(--color-surface)",
                  border:          "var(--border-width) solid var(--color-border)",
                  borderRadius:    "var(--card-radius)",
                  padding:         "var(--space-24)",
                }}
              >
                <p
                  style={{
                    fontSize:     "var(--text-xs)",
                    color:        "var(--color-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom:  "var(--space-8)",
                  }}
                >
                  {label}
                </p>
                <p
                  style={{
                    fontSize:   "var(--text-lg)",
                    fontWeight: "var(--font-focal)",
                    color:      "var(--color-text-primary)",
                  }}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Data quality */}
          <div
            style={{
              marginBottom: "var(--space-48)",
              fontSize:     "var(--text-sm)",
              color:        "var(--color-text-secondary)",
            }}
          >
            Average data quality:{" "}
            <span style={{ color: "var(--color-text-primary)" }}>
              {(kpis.avg_data_quality * 100).toFixed(0)}%
            </span>
            {" · "}Method mix:{" "}
            <span style={{ color: "var(--color-text-primary)" }}>
              {methodBreakdownLabel(kpis.method_breakdown)}
            </span>
          </div>
        </>
      )}

      {/* Sector breakdown */}
      {!sectorsLoading && sectors.length > 0 && (
        <div style={{ marginBottom: "var(--space-48)" }}>
          <h2
            style={{
              fontSize:     "var(--text-base)",
              fontWeight:   "var(--font-focal)",
              color:        "var(--color-text-primary)",
              marginBottom: "var(--space-16)",
            }}
          >
            Emissions by sector
          </h2>
          <div
            style={{
              border:          "var(--border-width) solid var(--color-border)",
              borderRadius:    "var(--card-radius)",
              overflow:        "hidden",
              backgroundColor: "var(--color-surface)",
            }}
          >
            {/* Header */}
            <div
              style={{
                display:             "grid",
                gridTemplateColumns: "1fr 160px 80px",
                gap:                 "var(--space-16)",
                padding:             "var(--space-16) var(--space-24)",
                borderBottom:        "var(--border-width) solid var(--color-border)",
                backgroundColor:     "var(--color-bg)",
              }}
            >
              {["Sector", "Total tCO₂e", "Cases"].map((col) => (
                <span
                  key={col}
                  style={{
                    fontSize:      "var(--text-xs)",
                    fontWeight:    "var(--font-focal)",
                    color:         "var(--color-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {col}
                </span>
              ))}
            </div>
            {sectors.map((s, i) => (
              <div
                key={s.sector}
                style={{
                  display:             "grid",
                  gridTemplateColumns: "1fr 160px 80px",
                  gap:                 "var(--space-16)",
                  padding:             "var(--space-16) var(--space-24)",
                  borderTop:           i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
                }}
              >
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)" }}>
                  {s.sector}
                </span>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  {formatTco2e(s.total_kgco2e)}
                </span>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
                  {s.case_count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Country intensity */}
      {!countriesLoading && countries.length > 0 && (
        <div>
          <h2
            style={{
              fontSize:     "var(--text-base)",
              fontWeight:   "var(--font-focal)",
              color:        "var(--color-text-primary)",
              marginBottom: "var(--space-16)",
            }}
          >
            Emissions intensity by origin
          </h2>
          <div
            style={{
              border:          "var(--border-width) solid var(--color-border)",
              borderRadius:    "var(--card-radius)",
              overflow:        "hidden",
              backgroundColor: "var(--color-surface)",
            }}
          >
            {/* Header */}
            <div
              style={{
                display:             "grid",
                gridTemplateColumns: "1fr 160px 80px",
                gap:                 "var(--space-16)",
                padding:             "var(--space-16) var(--space-24)",
                borderBottom:        "var(--border-width) solid var(--color-border)",
                backgroundColor:     "var(--color-bg)",
              }}
            >
              {["Country", "kg CO₂e / tonne", "Cases"].map((col) => (
                <span
                  key={col}
                  style={{
                    fontSize:      "var(--text-xs)",
                    fontWeight:    "var(--font-focal)",
                    color:         "var(--color-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {col}
                </span>
              ))}
            </div>
            {countries.slice(0, 10).map((c, i) => (
              <div
                key={c.country_code}
                style={{
                  display:             "grid",
                  gridTemplateColumns: "1fr 160px 80px",
                  gap:                 "var(--space-16)",
                  padding:             "var(--space-16) var(--space-24)",
                  borderTop:           i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
                }}
              >
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)" }}>
                  {c.country_name} ({c.country_code})
                </span>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  {c.avg_kgco2e_per_tonne.toLocaleString("en-GB", { maximumFractionDigits: 1 })}
                </span>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
                  {c.case_count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
