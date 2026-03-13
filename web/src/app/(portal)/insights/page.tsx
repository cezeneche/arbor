"use client";

/**
 * /insights — Sourcing intelligence & carbon analytics
 *
 * Data: useKPIs + useCountryIntensity + useSectorSummary + useSupplierComparison
 * EORI is derived from the first case returned by useCases().
 * All cost figures re-compute live as the ETS price slider moves.
 */

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
  PieChart,
  Pie,
} from "recharts";

import { MetricCard }   from "@/components/ui/MetricCard";
import { EmptyState }   from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/SkeletonRow";

import { useCases }            from "@/lib/hooks/useCases";
import {
  useKPIs,
  useCountryIntensity,
  useSectorSummary,
  useSupplierComparison,
} from "@/lib/hooks/useInsights";

import type { KPIs, CountryIntensity, SectorSummary, SupplierRanking } from "@/lib/api/types";

/* ══════════════════════════════════════════════════════════════════════════════
   Constants
══════════════════════════════════════════════════════════════════════════════ */

const NOW_YEAR    = new Date().getFullYear();
const ETS_MIN     = 20;
const ETS_MAX     = 150;
const ETS_STEP    = 5;
const ETS_DEFAULT = 65;

/* Chart palette — direct hex values (Recharts cannot read CSS custom properties) */
const C_TEAL    = "#1D9E75";
const C_AMBER   = "#F59E0B";
const C_MUTED   = "#7A99BB";
const C_GRID    = "#1E2D42";
const C_SURFACE = "#131E2E";
const C_DIM     = "#2A3F5A";

const SECTOR_PALETTE = [
  "#1D9E75", "#14B8A6", "#0EA5E9",
  "#8B5CF6", "#F59E0B", "#EF4444",
];

const SECTOR_LABELS: Record<string, string> = {
  cement:      "Cement",
  iron_steel:  "Iron & Steel",
  aluminium:   "Aluminium",
  fertilisers: "Fertilisers",
  electricity: "Electricity",
  hydrogen:    "Hydrogen",
};

/* ══════════════════════════════════════════════════════════════════════════════
   Formatting helpers
══════════════════════════════════════════════════════════════════════════════ */

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: decimals });
}
function fmtT(kg: number): string { return fmt(kg / 1000, 1); }
function fmtEur(n: number): string { return `\u20AC${fmt(Math.round(n))}`; }

/* ══════════════════════════════════════════════════════════════════════════════
   Shared card wrapper
══════════════════════════════════════════════════════════════════════════════ */

function InsightsCard({
  title,
  children,
  minHeight = 280,
}: {
  title:      string;
  children:   React.ReactNode;
  minHeight?: number;
}) {
  return (
    <div
      style={{
        display:         "flex",
        flexDirection:   "column",
        gap:             "var(--space-4)",
        padding:         "var(--space-5)",
        backgroundColor: "var(--color-surface)",
        border:          "1px solid var(--color-border)",
        borderRadius:    "var(--radius-xl)",
        minHeight,
      }}
    >
      <h2
        style={{
          margin:        0,
          fontSize:      "var(--text-base)",
          fontWeight:    "var(--font-weight-semibold)",
          color:         "var(--color-text-secondary)",
          letterSpacing: "var(--tracking-wide)",
        }}
      >
        {title}
      </h2>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Country chart — horizontal bars, highest highlighted amber
══════════════════════════════════════════════════════════════════════════════ */

function CountryChart({ countries }: { countries: CountryIntensity[] }) {
  if (countries.length === 0) {
    return (
      <EmptyState
        title="No country data yet"
        message="Upload your first shipment to see origin country breakdown."
      />
    );
  }

  const sorted = [...countries].sort((a, b) => b.total_kgco2e - a.total_kgco2e);
  const maxVal = sorted[0]?.total_kgco2e ?? 1;

  const data = sorted.slice(0, 10).map((c) => ({
    name:  c.country_name.length > 18 ? c.country_name.slice(0, 17) + "\u2026" : c.country_name,
    value: c.total_kgco2e / 1000,
    label: `${fmtT(c.total_kgco2e)}t`,
    isMax: c.total_kgco2e === maxVal,
  }));

  const height = Math.max(data.length * 44 + 16, 220);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 0, right: 72, bottom: 0, left: 4 }}
        barCategoryGap="28%"
      >
        <XAxis
          type="number"
          tick={{ fontSize: 13, fill: C_MUTED }}
          tickLine={false}
          axisLine={{ stroke: C_GRID }}
          tickFormatter={(v: number) => `${fmt(v, 0)}t`}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fontSize: 13, fill: C_MUTED }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: C_GRID }}
          contentStyle={{ backgroundColor: C_SURFACE, border: `1px solid ${C_GRID}`, borderRadius: 8, fontSize: 13 }}
          formatter={(v: number | undefined) => [`${fmt(v ?? 0, 1)} tCO\u2082e`, "Emissions"]}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={32}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.isMax ? C_AMBER : C_TEAL} />
          ))}
          <LabelList
            dataKey="label"
            position="right"
            style={{ fontSize: 13, fill: C_MUTED }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Supplier opportunity — SEE ranking bar chart
══════════════════════════════════════════════════════════════════════════════ */

function SupplierOpportunity({
  suppliers,
  topCnCode,
  topCnKgco2e,
  etsPrice,
  isLoading,
}: {
  suppliers:   SupplierRanking[];
  topCnCode:   string | undefined;
  topCnKgco2e: number | undefined;
  etsPrice:    number;
  isLoading:   boolean;
}) {
  if (isLoading) return <SkeletonList count={4} />;

  if (!topCnCode || suppliers.length === 0) {
    return (
      <EmptyState
        title="No supplier data yet"
        message="Upload your first shipment to see supplier comparisons."
      />
    );
  }

  const sorted  = [...suppliers].sort((a, b) => a.avg_kgco2e_per_unit - b.avg_kgco2e_per_unit);
  const minSEE  = sorted[0].avg_kgco2e_per_unit;
  const meanSEE = suppliers.reduce((s, x) => s + x.avg_kgco2e_per_unit, 0) / suppliers.length;

  const potentialSavingKg = topCnKgco2e
    ? ((meanSEE - minSEE) / meanSEE) * topCnKgco2e
    : undefined;
  const potentialCostSaving = potentialSavingKg
    ? (potentialSavingKg / 1000) * etsPrice
    : undefined;

  const bestSupplier = sorted[0];
  const pctBelow = Math.round(((meanSEE - minSEE) / meanSEE) * 100);

  const data = sorted.map((s) => {
    const label = `${s.origin_country} \u2014 ${s.supplier_name}`;
    return {
      name:  label.length > 26 ? label.slice(0, 25) + "\u2026" : label,
      value: s.avg_kgco2e_per_unit,
      isMin: s.avg_kgco2e_per_unit === minSEE,
    };
  });

  const height = Math.max(data.length * 44 + 16, 200);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {/* CN code + potential saving badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: "var(--space-2)" }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
          CN {topCnCode}
        </span>
        {potentialCostSaving !== undefined && potentialCostSaving > 0 && (
          <span
            style={{
              display:         "inline-flex",
              alignItems:      "center",
              padding:         "2px 10px",
              borderRadius:    "var(--radius-full)",
              backgroundColor: "var(--color-approved-bg)",
              border:          "1px solid var(--color-approved-border)",
              fontSize:        "var(--text-xs)",
              fontWeight:      "var(--font-weight-semibold)",
              color:           "var(--color-approved-text)",
            }}
          >
            Save up to {fmtEur(potentialCostSaving)} / yr
          </span>
        )}
      </div>

      {/* SEE bar chart */}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 0, right: 72, bottom: 8, left: 4 }}
          barCategoryGap="28%"
        >
          <XAxis
            type="number"
            tick={{ fontSize: 13, fill: C_MUTED }}
            tickLine={false}
            axisLine={{ stroke: C_GRID }}
            tickFormatter={(v: number) => fmt(v, 1)}
            label={{ value: "kgCO\u2082e / unit", position: "insideBottomRight", offset: -4, fontSize: 12, fill: C_MUTED }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={130}
            tick={{ fontSize: 13, fill: C_MUTED }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: C_GRID }}
            contentStyle={{ backgroundColor: C_SURFACE, border: `1px solid ${C_GRID}`, borderRadius: 8, fontSize: 13 }}
            formatter={(v: number | undefined) => [`${fmt(v ?? 0, 2)} kgCO\u2082e / unit`, "SEE"]}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.isMin ? C_TEAL : C_DIM} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any) => fmt(Number(v) || 0, 2)}
              style={{ fontSize: 13, fill: C_MUTED }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Best supplier callout */}
      <div
        style={{
          display:         "flex",
          alignItems:      "flex-start",
          gap:             "var(--space-3)",
          padding:         "var(--space-3) var(--space-4)",
          backgroundColor: "var(--color-surface-raised)",
          borderRadius:    "var(--radius-md)",
          border:          "1px solid var(--color-approved-border)",
        }}
      >
        <span style={{ fontSize: "18px", flexShrink: 0, lineHeight: "1.4" }} aria-hidden="true">🌱</span>
        <div>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-approved-text)" }}>
            Lowest-carbon origin: {bestSupplier.origin_country}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
            {fmt(minSEE, 2)} kgCO₂e / unit — {pctBelow}% below average
          </p>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Sector chart — donut with custom legend
══════════════════════════════════════════════════════════════════════════════ */

function SectorChart({ sectors }: { sectors: SectorSummary[] }) {
  if (sectors.length === 0) {
    return (
      <EmptyState
        title="No sector data yet"
        message="Upload your first shipment to see sector breakdown."
      />
    );
  }

  const total = sectors.reduce((s, x) => s + x.total_kgco2e, 0) || 1;

  const data = sectors
    .filter((s) => s.total_kgco2e > 0)
    .sort((a, b) => b.total_kgco2e - a.total_kgco2e)
    .map((s, i) => ({
      name:  SECTOR_LABELS[s.sector] ?? s.sector,
      value: s.total_kgco2e,
      tco2e: fmtT(s.total_kgco2e),
      pct:   Math.round((s.total_kgco2e / total) * 100),
      fill:  SECTOR_PALETTE[i % SECTOR_PALETTE.length],
    }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={100}
            dataKey="value"
            paddingAngle={2}
            startAngle={90}
            endAngle={-270}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.fill} stroke="none" />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: C_SURFACE,
              border:          `1px solid ${C_GRID}`,
              borderRadius:    8,
              fontSize:        13,
            }}
            formatter={(v: number | undefined) => [`${fmtT(v ?? 0)} tCO\u2082e`, "Emissions"]}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Custom legend */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {data.map((entry, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
              <span
                aria-hidden="true"
                style={{
                  display:         "inline-block",
                  width:           "10px",
                  height:          "10px",
                  borderRadius:    "2px",
                  backgroundColor: entry.fill,
                  flexShrink:      0,
                }}
              />
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                {entry.name}
              </span>
            </div>
            <div style={{ display: "flex", gap: "var(--space-3)", flexShrink: 0 }}>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
                {entry.tco2e} t
              </span>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", minWidth: "36px", textAlign: "right" as const }}>
                {entry.pct}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Method breakdown — three annotated large numbers
══════════════════════════════════════════════════════════════════════════════ */

const METHOD_CONFIG = [
  {
    key:    "actual"    as const,
    label:  "Actual",
    desc:   "Supplier declared data used",
    colour: "var(--color-approved-text)",
    bg:     "var(--color-approved-bg)",
    border: "var(--color-approved-border)",
  },
  {
    key:    "estimated" as const,
    label:  "Estimated",
    desc:   "Partial supplier data, gaps filled",
    colour: "var(--color-pending-text)",
    bg:     "var(--color-pending-bg)",
    border: "var(--color-pending-border)",
  },
  {
    key:    "default"   as const,
    label:  "Default",
    desc:   "EU Annex VI fallback values",
    colour: "var(--color-flagged-text)",
    bg:     "var(--color-flagged-bg)",
    border: "var(--color-flagged-border)",
  },
] as const;

function MethodBreakdown({ kpis }: { kpis: KPIs | undefined }) {
  if (!kpis) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              height:          "80px",
              borderRadius:    "var(--radius-lg)",
              backgroundColor: "var(--color-surface-raised)",
              border:          "1px solid var(--color-border)",
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {METHOD_CONFIG.map((m) => {
        const count = kpis.method_breakdown[m.key] ?? 0;
        return (
          <div
            key={m.key}
            style={{
              display:         "flex",
              alignItems:      "center",
              gap:             "var(--space-4)",
              padding:         "var(--space-4)",
              backgroundColor: m.bg,
              border:          `1px solid ${m.border}`,
              borderRadius:    "var(--radius-lg)",
            }}
          >
            <span
              style={{
                fontSize:   "var(--text-4xl)",
                fontWeight: "var(--font-weight-bold)",
                color:      m.colour,
                lineHeight: 1,
                flexShrink: 0,
                minWidth:   "56px",
                fontFamily: "var(--font-sans)",
              }}
              aria-label={`${count} cases using ${m.label} method`}
            >
              {fmt(count)}
            </span>
            <div>
              <p style={{ margin: 0, fontSize: "var(--text-base)", fontWeight: "var(--font-weight-semibold)", color: m.colour }}>
                {m.label}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: "var(--text-xs)", color: m.colour, opacity: 0.8 }}>
                {m.desc}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Page
══════════════════════════════════════════════════════════════════════════════ */

export default function InsightsPage() {
  const [etsPrice, setEtsPrice] = useState(ETS_DEFAULT);

  const { cases, isLoading: casesLoading } = useCases();
  const eori    = cases[0]?.importer_eori;
  const hasData = Boolean(eori);

  const { kpis,      isLoading: kpisLoading }      = useKPIs(eori, NOW_YEAR, etsPrice);
  const { countries, isLoading: countriesLoading } = useCountryIntensity(eori);
  const { sectors,   isLoading: sectorsLoading }   = useSectorSummary(eori);

  /* Supplier comparison requires the top CN code from KPIs */
  const topCnCode   = kpis?.top_cn_codes?.[0]?.cn_code;
  const topCnKgco2e = kpis?.top_cn_codes?.[0]?.kgco2e;
  const { suppliers, isLoading: suppliersLoading } = useSupplierComparison(eori, topCnCode);

  /* Derived KPI values */
  const certs    = kpis ? Math.ceil(kpis.total_kgco2e / 1000) : 0;
  const cbamCost = kpis?.estimated_cbam_cost ?? certs * etsPrice;

  /* Global empty state — no cases at all */
  if (!casesLoading && !hasData) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <EmptyState
          title="No insights yet"
          message="Upload your first shipment to see insights."
        />
      </div>
    );
  }

  const kpiLoading = casesLoading || kpisLoading;
  const sliderPct  = ((etsPrice - ETS_MIN) / (ETS_MAX - ETS_MIN)) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>

      {/* ── Page header ───────────────────────────────────────────────────────── */}
      <div>
        <h1
          style={{
            margin:      0,
            fontSize:    "var(--text-2xl)",
            fontWeight:  "var(--font-weight-semibold)",
            color:       "var(--color-text-primary)",
            lineHeight:  "var(--leading-tight)",
          }}
        >
          Sourcing insights
        </h1>
        <p
          style={{
            margin:     "var(--space-1) 0 0",
            fontSize:   "var(--text-base)",
            color:      "var(--color-text-secondary)",
            lineHeight: "var(--leading-normal)",
          }}
        >
          Carbon exposure across your import corridors
        </p>
      </div>

      {/* ── ETS price sensitivity slider ─────────────────────────────────────── */}
      <div
        style={{
          display:         "flex",
          flexDirection:   "column",
          gap:             "var(--space-2)",
          padding:         "var(--space-5)",
          backgroundColor: "var(--color-surface)",
          border:          "1px solid var(--color-border)",
          borderRadius:    "var(--radius-xl)",
          maxWidth:        "520px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}>
          <label
            htmlFor="ets-slider"
            style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-secondary)", cursor: "default" }}
          >
            EU ETS carbon price
          </label>
          <span
            aria-live="polite"
            style={{
              fontSize:   "var(--text-xl)",
              fontWeight: "var(--font-weight-bold)",
              color:      "var(--color-accent-text)",
              fontFamily: "var(--font-mono)",
              minWidth:   "100px",
              textAlign:  "right" as const,
            }}
          >
            {fmtEur(etsPrice)} / t
          </span>
        </div>

        <input
          id="ets-slider"
          type="range"
          min={ETS_MIN}
          max={ETS_MAX}
          step={ETS_STEP}
          value={etsPrice}
          onChange={(e) => setEtsPrice(Number(e.target.value))}
          aria-valuemin={ETS_MIN}
          aria-valuemax={ETS_MAX}
          aria-valuenow={etsPrice}
          aria-valuetext={`${fmtEur(etsPrice)} per tonne`}
          style={{
            width:       "100%",
            appearance:  "none" as const,
            height:      "6px",
            borderRadius:"var(--radius-full)",
            background:  `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${sliderPct}%, var(--color-border) ${sliderPct}%, var(--color-border) 100%)`,
            outline:     "none",
            cursor:      "pointer",
          }}
        />

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{fmtEur(ETS_MIN)}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            Adjust to model your liability at different carbon prices
          </span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{fmtEur(ETS_MAX)}</span>
        </div>
      </div>

      {/* ── Row 1: KPI metrics ────────────────────────────────────────────────── */}
      {kpiLoading ? (
        <SkeletonList count={1} />
      ) : (
        <div className="cbam-grid-4">
          <MetricCard
            label="Total cases this year"
            value={kpis ? fmt(kpis.total_cases) : "—"}
          />
          <MetricCard
            label="Total embedded CO₂e"
            value={kpis ? fmtT(kpis.total_kgco2e) : "—"}
            unit="tCO₂e"
          />
          <MetricCard
            label="Certificates needed"
            value={kpis ? fmt(certs) : "—"}
          />
          <MetricCard
            label="Estimated CBAM cost"
            value={kpis ? fmtEur(cbamCost) : "—"}
            alert={kpis !== undefined && cbamCost > 100_000}
          />
        </div>
      )}

      {/* ── Row 2: Country chart + Supplier opportunity ───────────────────────── */}
      <div className="cbam-grid-2">
        <InsightsCard title="Emissions by origin country" minHeight={320}>
          {countriesLoading ? (
            <SkeletonList count={5} />
          ) : (
            <CountryChart countries={countries} />
          )}
        </InsightsCard>

        <InsightsCard title="Lowest-carbon supplier opportunity" minHeight={320}>
          <SupplierOpportunity
            suppliers={suppliers}
            topCnCode={topCnCode}
            topCnKgco2e={topCnKgco2e}
            etsPrice={etsPrice}
            isLoading={suppliersLoading}
          />
        </InsightsCard>
      </div>

      {/* ── Row 3: Sector chart + Method breakdown ────────────────────────────── */}
      <div className="cbam-grid-2">
        <InsightsCard title="Emissions by sector" minHeight={320}>
          {sectorsLoading ? (
            <SkeletonList count={4} />
          ) : (
            <SectorChart sectors={sectors} />
          )}
        </InsightsCard>

        <InsightsCard title="Calculation method breakdown" minHeight={320}>
          <MethodBreakdown kpis={kpis} />
        </InsightsCard>
      </div>

    </div>
  );
}
