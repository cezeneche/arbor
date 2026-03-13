"use client";

/**
 * /dashboard — unified CBAM portal home screen
 *
 * Five URL states (no page reloads — silent query-param navigation):
 *   /dashboard              → STATE 1: Home
 *   /dashboard?view=upload  → STATE 2: Upload document
 *   /dashboard?view=cases   → STATE 3: Cases list
 *   /dashboard?view=review  → redirected from home AlertBanner CTA
 *   /dashboard?case=UUID    → STATE 4: Case detail (overrides ?view)
 */

import { Suspense, useCallback, useRef, useState } from "react";
import { useSearchParams, useRouter }               from "next/navigation";

import { AlertBanner }       from "@/components/ui/AlertBanner";
import { MetricCard }        from "@/components/ui/MetricCard";
import { ActionButton }      from "@/components/ui/ActionButton";
import { CaseRow }           from "@/components/ui/CaseRow";
import { Badge }             from "@/components/ui/badge";
import { EmptyState }        from "@/components/ui/EmptyState";
import { SkeletonList }      from "@/components/ui/SkeletonRow";

import { useCases, useCase, useReportPackage } from "@/lib/hooks/useCases";
import { useKPIs }           from "@/lib/hooks/useInsights";
import { useUpload }         from "@/lib/hooks/useUpload";
import { useAuth }           from "@/lib/auth/useAuth";
import { ledgerFetch }       from "@/lib/api/client";
import { approveCase, rejectCase } from "@/lib/api/cases";

import type { Case }         from "@/lib/api/types";
import type { StatusValue }  from "@/components/ui/StatusDot";

/* ══════════════════════════════════════════════════════════════════════════════
   Constants & helpers
══════════════════════════════════════════════════════════════════════════════ */

const NOW_YEAR    = new Date().getFullYear();
const NOW_QUARTER = Math.ceil((new Date().getMonth() + 1) / 3) as 1 | 2 | 3 | 4;

function caseToStatus(c: Case): StatusValue {
  if (c.review_status === "approved")      return "approved";
  if (c.review_status === "pending_review") return "pending";
  if (c.review_status === "rejected")      return "flagged";
  if (c.status === "signed_off")           return "approved";
  return "processing";
}

function caseActionLabel(c: Case): string {
  return c.review_status === "pending_review" || c.review_status === "rejected"
    ? "Review"
    : "View";
}

function formatTCO2(kg: number | undefined): string {
  if (kg === undefined || kg === null) return "—";
  return (kg / 1000).toFixed(1);
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return "🌍";
  const OFFSET = 127397;
  const upper = code.toUpperCase();
  return (
    String.fromCodePoint(upper.charCodeAt(0) + OFFSET) +
    String.fromCodePoint(upper.charCodeAt(1) + OFFSET)
  );
}

/* Shared section heading */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin:        0,
        fontSize:      "var(--text-lg)",
        fontWeight:    "var(--font-weight-semibold)",
        color:         "var(--color-text-primary)",
        lineHeight:    "var(--leading-snug)",
      }}
    >
      {children}
    </h2>
  );
}

/* Back button */
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display:         "inline-flex",
        alignItems:      "center",
        gap:             "6px",
        minHeight:       "var(--touch-min)",
        padding:         "0 var(--space-3)",
        borderRadius:    "var(--radius-md)",
        border:          "1px solid var(--color-border)",
        backgroundColor: "transparent",
        color:           "var(--color-text-secondary)",
        fontSize:        "var(--text-sm)",
        fontWeight:      "var(--font-weight-medium)",
        fontFamily:      "var(--font-sans)",
        cursor:          "pointer",
        outline:         "none",
        transition:      "background-color var(--transition-fast)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor =
          "var(--color-surface-raised)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
      }}
    >
      <span aria-hidden="true">←</span>
      Back
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   STATE 1 — Home view
══════════════════════════════════════════════════════════════════════════════ */

function HomeView({ onNavigate }: { onNavigate: (view: string) => void }) {
  const { cases, isLoading } = useCases();

  const thisQuarterCases = cases.filter(
    (c) => c.reporting_year === NOW_YEAR && c.reporting_quarter === NOW_QUARTER
  );
  const pendingCount = cases.filter(
    (c) => c.review_status === "pending_review"
  ).length;

  const firstEori = cases[0]?.importer_eori;
  const { kpis } = useKPIs(firstEori, NOW_YEAR);

  const recentFive = cases.slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>

      {/* Alert if any cases need attention */}
      {!isLoading && pendingCount > 0 && (
        <AlertBanner
          severity="warning"
          message={`${pendingCount} shipment${pendingCount === 1 ? "" : "s"} need${pendingCount === 1 ? "s" : ""} your attention.`}
          ctaLabel="Review now"
          onCta={() => onNavigate("cases")}
        />
      )}

      {/* KPI metrics */}
      <div
        style={{
          display:             "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap:                 "var(--space-4)",
        }}
      >
        <MetricCard
          label="Cases this quarter"
          value={isLoading ? "—" : thisQuarterCases.length}
        />
        <MetricCard
          label="Total CO₂ liability"
          value={formatTCO2(kpis?.total_kgco2e)}
          unit="tCO₂e"
        />
        <MetricCard
          label="Awaiting review"
          value={isLoading ? "—" : pendingCount}
          alert={pendingCount > 0}
        />
      </div>

      {/* Quick actions */}
      <div className="cbam-action-row">
        <ActionButton
          variant="primary"
          label="Upload a document"
          sublabel="Invoice, certificate or customs file"
          onClick={() => onNavigate("upload")}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
        />
        <ActionButton
          variant="secondary"
          label="View my cases"
          sublabel="All shipments and their status"
          onClick={() => onNavigate("cases")}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
              <line x1="3" y1="9"  x2="21" y2="9"  stroke="currentColor" strokeWidth="2" />
              <line x1="3" y1="15" x2="21" y2="15" stroke="currentColor" strokeWidth="2" />
              <line x1="9" y1="3"  x2="9"  y2="21" stroke="currentColor" strokeWidth="2" />
            </svg>
          }
        />
      </div>

      {/* Recent shipments */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <SectionHeading>Recent shipments</SectionHeading>

        {isLoading ? (
          <SkeletonList count={5} />
        ) : recentFive.length === 0 ? (
          <EmptyState
            title="No shipments yet"
            message="Upload your first invoice to get started."
            ctaLabel="Upload a document"
            onCta={() => onNavigate("upload")}
          />
        ) : (
          <div
            style={{
              borderRadius: "var(--radius-lg)",
              border:       "1px solid var(--color-border)",
              overflow:     "hidden",
            }}
          >
            {recentFive.map((c) => (
              <CaseRow
                key={c.id}
                caseId={c.id.slice(0, 8).toUpperCase()}
                title={c.importer_name}
                subtitle={`Q${c.reporting_quarter} ${c.reporting_year} · ${c.importer_eori}`}
                status={caseToStatus(c)}
                actionLabel={caseActionLabel(c)}
                onClick={() => onNavigate(`__case__${c.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   STATE 2 — Upload view
══════════════════════════════════════════════════════════════════════════════ */

type UploadPhase = "form" | "progress" | "success" | "error";

function UploadView({
  onBack,
  onViewCase,
}: {
  onBack:      () => void;
  onViewCase:  (caseId: string) => void;
}) {
  const [eori,       setEori]       = useState("");
  const [year,       setYear]       = useState(NOW_YEAR);
  const [quarter,    setQuarter]    = useState<1 | 2 | 3 | 4>(NOW_QUARTER);
  const [isDragOver, setIsDragOver] = useState(false);
  const [phase,      setPhase]      = useState<UploadPhase>("form");
  const [fileName,   setFileName]   = useState("");
  const [creating,   setCreating]   = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { step, progress, result, error, upload, reset } = useUpload();

  const handleFile = useCallback(
    async (file: File) => {
      if (!eori.trim()) return;

      setFileName(file.name);
      setPhase("progress");
      setCreating(true);

      let caseId: string;
      try {
        const created = await ledgerFetch<{ id: string }>("/api/cbam/cases", {
          method: "POST",
          body:   JSON.stringify({
            importer_eori:     eori.trim().toUpperCase(),
            reporting_year:    year,
            reporting_quarter: quarter,
          }),
        });
        caseId = created.id;
      } catch {
        setPhase("error");
        setCreating(false);
        return;
      }

      setCreating(false);
      await upload(file, caseId);
    },
    [eori, year, quarter, upload]
  );

  // Watch for upload completion
  const prevStep = useRef(step);
  if (prevStep.current !== step) {
    prevStep.current = step;
    if (step === "done") setPhase("success");
    if (step === "error") setPhase("error");
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  const inputStyle: React.CSSProperties = {
    display:         "block",
    width:           "100%",
    padding:         "var(--space-3) var(--space-4)",
    borderRadius:    "var(--radius-md)",
    border:          "1px solid var(--color-border)",
    backgroundColor: "var(--color-surface-raised)",
    color:           "var(--color-text-primary)",
    fontFamily:      "var(--font-sans)",
    fontSize:        "var(--text-base)",
    outline:         "none",
    boxSizing:       "border-box" as const,
  };

  const labelStyle: React.CSSProperties = {
    display:    "block",
    fontSize:   "var(--text-sm)",
    fontWeight: "var(--font-weight-semibold)",
    color:      "var(--color-text-secondary)",
    marginBottom: "6px",
  };

  const isFormReady = eori.trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: "600px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
        <BackButton onClick={onBack} />
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--font-weight-bold)", color: "var(--color-text-primary)" }}>
            Upload a document
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            Drop your invoice, certificate or customs file here
          </p>
        </div>
      </div>

      {phase === "form" && (
        <>
          {/* EORI + period mini-form */}
          <div
            style={{
              display:         "flex",
              flexDirection:   "column",
              gap:             "var(--space-4)",
              padding:         "var(--space-5)",
              backgroundColor: "var(--color-surface)",
              borderRadius:    "var(--radius-lg)",
              border:          "1px solid var(--color-border)",
            }}
          >
            <div>
              <label htmlFor="eori-input" style={labelStyle}>Importer EORI number</label>
              <input
                id="eori-input"
                type="text"
                value={eori}
                onChange={(e) => setEori(e.target.value)}
                placeholder="e.g. GB123456789000"
                style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              <div>
                <label htmlFor="year-select" style={labelStyle}>Reporting year</label>
                <select
                  id="year-select"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  style={inputStyle}
                >
                  {[NOW_YEAR - 1, NOW_YEAR, NOW_YEAR + 1].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="quarter-select" style={labelStyle}>Reporting quarter</label>
                <select
                  id="quarter-select"
                  value={quarter}
                  onChange={(e) => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}
                  style={inputStyle}
                >
                  {([1, 2, 3, 4] as const).map((q) => (
                    <option key={q} value={q}>Q{q}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop zone — click to select a file or drag and drop"
            onClick={() => isFormReady && fileInputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && isFormReady && fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); if (isFormReady) setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => { if (isFormReady) handleDrop(e); }}
            style={{
              display:         "flex",
              flexDirection:   "column",
              alignItems:      "center",
              justifyContent:  "center",
              gap:             "var(--space-3)",
              minHeight:       "200px",
              padding:         "var(--space-8)",
              borderRadius:    "var(--radius-xl)",
              border:          `2px dashed ${isDragOver ? "var(--color-accent)" : "var(--color-border)"}`,
              backgroundColor: isDragOver
                ? "var(--color-accent-subtle)"
                : isFormReady
                  ? "var(--color-surface)"
                  : "var(--color-surface-raised)",
              cursor:          isFormReady ? "pointer" : "not-allowed",
              opacity:         isFormReady ? 1 : 0.5,
              transition:      "border-color var(--transition-fast), background-color var(--transition-fast)",
              textAlign:       "center" as const,
              boxSizing:       "border-box" as const,
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              style={{ color: isDragOver ? "var(--color-accent)" : "var(--color-text-muted)" }}
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>

            <p style={{ margin: 0, fontSize: "var(--text-base)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
              {isDragOver ? "Drop to upload" : "Drag your file here, or click to browse"}
            </p>
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
              PDF, Excel, or CSV · Max 20 MB
            </p>
            {!isFormReady && (
              <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                Enter your EORI number above first
              </p>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv"
            onChange={handleInputChange}
            style={{ display: "none" }}
            aria-hidden="true"
          />
        </>
      )}

      {/* Progress steps */}
      {phase === "progress" && (
        <div
          style={{
            display:         "flex",
            flexDirection:   "column",
            gap:             "var(--space-4)",
            padding:         "var(--space-6)",
            backgroundColor: "var(--color-surface)",
            borderRadius:    "var(--radius-lg)",
            border:          "1px solid var(--color-border)",
          }}
        >
          {/* Step 1 — Uploading */}
          <ProgressStep
            number={1}
            label="Uploading"
            active={step === "uploading"}
            done={step !== "uploading" && step !== "idle"}
          >
            {step === "uploading" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
                  {fileName}
                </p>
                <div
                  style={{
                    height:          "6px",
                    borderRadius:    "var(--radius-full)",
                    backgroundColor: "var(--color-surface-raised)",
                    overflow:        "hidden",
                  }}
                >
                  <div
                    style={{
                      height:          "100%",
                      width:           `${progress}%`,
                      borderRadius:    "var(--radius-full)",
                      backgroundColor: "var(--color-accent)",
                      transition:      "width 0.2s ease",
                    }}
                  />
                </div>
                <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                  {progress}% uploaded
                </p>
              </div>
            )}
          </ProgressStep>

          {/* Step 2 — Reading data */}
          <ProgressStep
            number={2}
            label="Reading data"
            active={step === "extracting"}
            done={step === "creating" || step === "done"}
          >
            {step === "extracting" && (
              <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: "8px" }}>
                <Spinner />
                Extracting CN codes, weights and emissions…
              </p>
            )}
          </ProgressStep>

          {/* Step 3 — Creating case */}
          <ProgressStep
            number={3}
            label="Creating case"
            active={step === "creating" || creating}
            done={step === "done"}
          >
            {(step === "creating" || creating) && (
              <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: "8px" }}>
                <Spinner />
                Building your CBAM case…
              </p>
            )}
          </ProgressStep>
        </div>
      )}

      {/* Success card */}
      {phase === "success" && result && (
        <div
          style={{
            display:         "flex",
            flexDirection:   "column",
            gap:             "var(--space-4)",
            padding:         "var(--space-6)",
            backgroundColor: "var(--color-approved-bg)",
            border:          "1px solid var(--color-approved-border)",
            borderRadius:    "var(--radius-lg)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ fontSize: "24px" }} aria-hidden="true">✓</span>
            <div>
              <p style={{ margin: 0, fontWeight: "var(--font-weight-semibold)", color: "var(--color-approved-text)" }}>
                Case created successfully
              </p>
              <p style={{ margin: "2px 0 0", fontSize: "var(--text-sm)", color: "var(--color-approved-text)", opacity: 0.8 }}>
                {result.shipments} shipment{result.shipments === 1 ? "" : "s"} · {result.goods_lines} goods line{result.goods_lines === 1 ? "" : "s"} found
              </p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
            <ActionButton
              variant="primary"
              label="View case"
              onClick={() => onViewCase(result.case_id)}
            />
            <ActionButton
              variant="secondary"
              label="Upload another"
              onClick={() => { reset(); setPhase("form"); setFileName(""); setEori(""); }}
            />
          </div>
        </div>
      )}

      {/* Error state */}
      {phase === "error" && (
        <div
          style={{
            display:         "flex",
            flexDirection:   "column",
            gap:             "var(--space-4)",
            padding:         "var(--space-6)",
            backgroundColor: "var(--alert-error-bg)",
            border:          "1px solid var(--alert-error-border)",
            borderRadius:    "var(--radius-lg)",
          }}
        >
          <p style={{ margin: 0, fontWeight: "var(--font-weight-semibold)", color: "var(--alert-error-text)" }}>
            Something went wrong
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--alert-error-text)" }}>
            {error?.message ?? "We could not process your document. Please check the file format and try again."}
          </p>
          <ActionButton
            variant="secondary"
            label="Try again"
            onClick={() => { reset(); setPhase("form"); setFileName(""); }}
          />
        </div>
      )}
    </div>
  );
}

/* Progress step sub-component (upload view) */
function ProgressStep({
  number,
  label,
  active,
  done,
  children,
}: {
  number:   number;
  label:    string;
  active:   boolean;
  done:     boolean;
  children?: React.ReactNode;
}) {
  const colour = done
    ? "var(--color-approved)"
    : active
      ? "var(--color-accent)"
      : "var(--color-border)";

  return (
    <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-start" }}>
      <div
        style={{
          flexShrink:      0,
          width:           "28px",
          height:          "28px",
          borderRadius:    "var(--radius-full)",
          border:          `2px solid ${colour}`,
          backgroundColor: done ? colour : "transparent",
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          fontSize:        "var(--text-xs)",
          fontWeight:      "var(--font-weight-bold)",
          color:           done ? "var(--color-text-on-accent)" : colour,
        }}
        aria-hidden="true"
      >
        {done ? "✓" : number}
      </div>
      <div style={{ flex: 1, paddingTop: "4px" }}>
        <p
          style={{
            margin:     0,
            fontSize:   "var(--text-sm)",
            fontWeight: "var(--font-weight-semibold)",
            color:      active || done ? "var(--color-text-primary)" : "var(--color-text-muted)",
          }}
        >
          {label}
        </p>
        {children && <div style={{ marginTop: "var(--space-2)" }}>{children}</div>}
      </div>
    </div>
  );
}

/* Inline spinner */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display:      "inline-block",
        width:        "14px",
        height:       "14px",
        borderRadius: "50%",
        border:       "2px solid var(--color-border)",
        borderTop:    "2px solid var(--color-accent)",
        animation:    "spin 0.8s linear infinite",
        flexShrink:   0,
      }}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   STATE 3 — Cases list view
══════════════════════════════════════════════════════════════════════════════ */

type FilterLabel = "All" | "Approved" | "Pending review" | "Processing" | "Flagged";

const FILTER_LABELS: FilterLabel[] = [
  "All", "Approved", "Pending review", "Processing", "Flagged",
];

function applyFilter(cases: Case[], filter: FilterLabel): Case[] {
  switch (filter) {
    case "Approved":     return cases.filter((c) => c.review_status === "approved" || c.status === "signed_off");
    case "Pending review": return cases.filter((c) => c.review_status === "pending_review");
    case "Processing":   return cases.filter((c) =>
      !c.review_status && c.status !== "signed_off"
    );
    case "Flagged":      return cases.filter((c) => c.review_status === "rejected");
    default:             return cases;
  }
}

function applySearch(cases: Case[], q: string): Case[] {
  if (!q.trim()) return cases;
  const term = q.toLowerCase();
  return cases.filter(
    (c) =>
      c.importer_eori.toLowerCase().includes(term) ||
      c.importer_name.toLowerCase().includes(term) ||
      c.id.toLowerCase().includes(term)
  );
}

function CasesView({
  onBack,
  onSelectCase,
}: {
  onBack:       () => void;
  onSelectCase: (caseId: string) => void;
}) {
  const { cases, isLoading } = useCases();
  const [filter, setFilter]  = useState<FilterLabel>("All");
  const [search, setSearch]  = useState("");

  const visible = applySearch(applyFilter(cases, filter), search);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
        <BackButton onClick={onBack} />
        <SectionHeading>Your shipments</SectionHeading>
      </div>

      {/* Filter pills + search */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {/* Filter pills */}
        <div
          role="group"
          aria-label="Filter shipments"
          style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" as const }}
        >
          {FILTER_LABELS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setFilter(label)}
              aria-pressed={filter === label}
              style={{
                minHeight:       "var(--touch-min)",
                padding:         "0 var(--space-4)",
                borderRadius:    "var(--radius-full)",
                border:          `1px solid ${filter === label ? "var(--color-accent)" : "var(--color-border)"}`,
                backgroundColor: filter === label ? "var(--color-accent-subtle)" : "transparent",
                color:           filter === label ? "var(--color-accent-text)" : "var(--color-text-secondary)",
                fontSize:        "var(--text-sm)",
                fontWeight:      "var(--font-weight-semibold)",
                fontFamily:      "var(--font-sans)",
                cursor:          "pointer",
                transition:      "all var(--transition-fast)",
                outline:         "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by invoice number or importer name"
          aria-label="Search shipments"
          style={{
            display:         "block",
            width:           "100%",
            maxWidth:        "420px",
            padding:         "var(--space-3) var(--space-4)",
            borderRadius:    "var(--radius-md)",
            border:          "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface)",
            color:           "var(--color-text-primary)",
            fontFamily:      "var(--font-sans)",
            fontSize:        "var(--text-sm)",
            outline:         "none",
            boxSizing:       "border-box" as const,
          }}
        />
      </div>

      {/* List */}
      {isLoading ? (
        <SkeletonList count={6} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={search || filter !== "All" ? "No cases match this filter" : "No shipments yet"}
          message={
            search || filter !== "All"
              ? "No cases match this filter."
              : "Upload your first invoice to get started."
          }
        />
      ) : (
        <div
          style={{
            borderRadius: "var(--radius-lg)",
            border:       "1px solid var(--color-border)",
            overflow:     "hidden",
          }}
        >
          {visible.map((c) => (
            <CaseRow
              key={c.id}
              caseId={c.id.slice(0, 8).toUpperCase()}
              title={c.importer_name}
              subtitle={`Q${c.reporting_quarter} ${c.reporting_year} · ${c.importer_eori}`}
              status={caseToStatus(c)}
              actionLabel={caseActionLabel(c)}
              onClick={() => onSelectCase(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   STATE 4 — Case detail view
══════════════════════════════════════════════════════════════════════════════ */

function CaseDetailView({
  caseId,
  onBack,
}: {
  caseId: string;
  onBack: () => void;
}) {
  const { case_: caseDetail, isLoading: caseLoading } = useCase(caseId);
  const { report, isLoading: reportLoading }           = useReportPackage(caseId);
  const { user }                                       = useAuth();

  const [narrativeOpen, setNarrativeOpen] = useState(false);
  const [modal,         setModal]         = useState<"approve" | "reject" | null>(null);
  const [reviewerName,  setReviewerName]  = useState(user?.name ?? user?.sub ?? "");
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [rejectReason,  setRejectReason]  = useState("");
  const [isSubmitting,  setIsSubmitting]  = useState(false);
  const [actionDone,    setActionDone]    = useState<"approved" | "rejected" | null>(null);

  const isLoading = caseLoading || reportLoading;

  const isPendingReview = caseDetail?.review_status === "pending_review";

  /* Derive origin country from first shipment */
  const originCountry = caseDetail?.shipments?.[0]?.origin_country ?? "";

  /* Determine most common method from case status */
  const methodLabel = caseDetail?.status === "signed_off"
    ? "Actual"
    : caseDetail?.status === "calculated" || caseDetail?.status === "resolved"
      ? "Actual"
      : caseDetail?.status === "extracted"
        ? "Default"
        : "—";

  const handleReviewSubmit = async () => {
    if (!caseDetail || isSubmitting) return;
    if (!reviewerName.trim() || !reviewerEmail.trim()) return;
    if (modal === "reject" && !rejectReason.trim()) return;

    setIsSubmitting(true);
    try {
      const decision = {
        reviewer_name:  reviewerName.trim(),
        reviewer_email: reviewerEmail.trim(),
        comments:       modal === "reject" ? rejectReason.trim() : undefined,
      };

      if (modal === "approve") {
        await approveCase(caseId, decision);
        setActionDone("approved");
      } else if (modal === "reject") {
        await rejectCase(caseId, decision);
        setActionDone("rejected");
      }
      setModal(null);
    } catch {
      /* Error already shown by ApiError — keep modal open so user can retry */
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    display:         "block",
    width:           "100%",
    padding:         "var(--space-3) var(--space-4)",
    borderRadius:    "var(--radius-md)",
    border:          "1px solid var(--color-border)",
    backgroundColor: "var(--color-surface-raised)",
    color:           "var(--color-text-primary)",
    fontFamily:      "var(--font-sans)",
    fontSize:        "var(--text-base)",
    outline:         "none",
    boxSizing:       "border-box" as const,
    resize:          "none" as const,
  };

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <BackButton onClick={onBack} />
          <SkeletonList count={1} />
        </div>
        <SkeletonList count={3} />
        <SkeletonList count={5} />
      </div>
    );
  }

  if (!caseDetail) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <BackButton onClick={onBack} />
        <EmptyState
          title="Case not found"
          message="This case may have been deleted or you may not have permission to view it."
          ctaLabel="Back to cases"
          onCta={onBack}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>

      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <BackButton onClick={onBack} />
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap" as const }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--font-weight-bold)", color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              {originCountry && (
                <span aria-hidden="true">{countryFlag(originCountry)}</span>
              )}
              {caseDetail.importer_name}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-2)", flexWrap: "wrap" as const }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                {new Date(caseDetail.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
              <Badge label={`Q${caseDetail.reporting_quarter} ${caseDetail.reporting_year}`} variant="quarter" />
              {originCountry && (
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
                  {originCountry}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action done banner */}
      {actionDone && (
        <div
          style={{
            padding:         "var(--space-4)",
            borderRadius:    "var(--radius-lg)",
            backgroundColor: actionDone === "approved" ? "var(--color-approved-bg)" : "var(--color-pending-bg)",
            border:          `1px solid ${actionDone === "approved" ? "var(--color-approved-border)" : "var(--color-pending-border)"}`,
            color:           actionDone === "approved" ? "var(--color-approved-text)" : "var(--color-pending-text)",
            fontWeight:      "var(--font-weight-semibold)",
          }}
          role="status"
        >
          {actionDone === "approved"
            ? "This case has been approved and recorded."
            : "This case has been sent back for revision."}
        </div>
      )}

      {/* Summary metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-4)" }}>
        <MetricCard
          label="Total direct CO₂e"
          value={report ? formatTCO2(report.total_direct_kgco2e) : "—"}
          unit="tCO₂e"
        />
        <MetricCard
          label="Total indirect CO₂e"
          value={report ? formatTCO2(report.total_indirect_kgco2e) : "—"}
          unit="tCO₂e"
        />
        <MetricCard
          label="Calculation method"
          value={methodLabel}
        />
      </div>

      {/* Goods lines table */}
      {caseDetail.goods_lines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <SectionHeading>Goods lines</SectionHeading>
          <div style={{ overflowX: "auto" as const, borderRadius: "var(--radius-lg)", border: "1px solid var(--color-border)" }}>
            <table
              style={{
                width:           "100%",
                borderCollapse:  "collapse" as const,
                fontFamily:      "var(--font-sans)",
                fontSize:        "var(--text-sm)",
              }}
            >
              <thead>
                <tr style={{ backgroundColor: "var(--color-surface-raised)", borderBottom: "1px solid var(--color-border)" }}>
                  {["CN code", "Sector", "Net mass", "Direct CO₂e", "Method"].map((col) => (
                    <th
                      key={col}
                      style={{
                        padding:   "var(--space-3) var(--space-4)",
                        textAlign: "left" as const,
                        fontWeight: "var(--font-weight-semibold)",
                        color:      "var(--color-text-muted)",
                        fontSize:   "var(--text-xs)",
                        textTransform: "uppercase" as const,
                        letterSpacing: "var(--tracking-wide)",
                        whiteSpace:  "nowrap" as const,
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {caseDetail.goods_lines.map((line, idx) => (
                  <tr
                    key={line.id}
                    style={{
                      borderBottom:    idx < caseDetail.goods_lines.length - 1 ? "1px solid var(--color-border)" : "none",
                      backgroundColor: "var(--color-surface)",
                    }}
                  >
                    <td style={{ padding: "var(--space-3) var(--space-4)", fontFamily: "var(--font-mono)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
                      {line.cn_code}
                    </td>
                    <td style={{ padding: "var(--space-3) var(--space-4)" }}>
                      <Badge label={line.sector.replace("_", " ")} variant="sector" />
                    </td>
                    <td style={{ padding: "var(--space-3) var(--space-4)", color: "var(--color-text-primary)" }}>
                      {line.net_mass_kg.toLocaleString("en-GB")} kg
                    </td>
                    <td style={{ padding: "var(--space-3) var(--space-4)", color: "var(--color-text-muted)" }}>
                      —
                    </td>
                    <td style={{ padding: "var(--space-3) var(--space-4)", color: "var(--color-text-muted)" }}>
                      —
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            Emissions are calculated at shipment level. Total CO₂e shown in the summary above.
          </p>
        </div>
      )}

      {/* Narrative (collapsible) */}
      {report?.narrative && (
        <div
          style={{
            borderRadius:    "var(--radius-lg)",
            border:          "1px solid var(--color-border)",
            overflow:        "hidden",
          }}
        >
          <button
            type="button"
            onClick={() => setNarrativeOpen((o) => !o)}
            aria-expanded={narrativeOpen}
            style={{
              display:         "flex",
              alignItems:      "center",
              justifyContent:  "space-between",
              width:           "100%",
              padding:         "var(--space-4) var(--space-5)",
              backgroundColor: "var(--color-surface)",
              border:          "none",
              cursor:          "pointer",
              fontFamily:      "var(--font-sans)",
              fontSize:        "var(--text-base)",
              fontWeight:      "var(--font-weight-semibold)",
              color:           "var(--color-text-primary)",
              textAlign:       "left" as const,
              outline:         "none",
            }}
          >
            <span>Compliance narrative</span>
            <span aria-hidden="true" style={{ transform: narrativeOpen ? "rotate(180deg)" : "none", transition: "transform var(--transition-fast)" }}>
              ▾
            </span>
          </button>
          {narrativeOpen && (
            <div
              style={{
                padding:         "var(--space-5)",
                backgroundColor: "var(--color-surface-raised)",
                borderTop:       "1px solid var(--color-border)",
                fontSize:        "var(--text-sm)",
                lineHeight:      "var(--leading-relaxed)",
                color:           "var(--color-text-secondary)",
                whiteSpace:      "pre-wrap" as const,
                fontFamily:      "var(--font-sans)",
              }}
            >
              {report.narrative}
            </div>
          )}
        </div>
      )}

      {/* Review actions */}
      {isPendingReview && !actionDone && (
        <div
          style={{
            display:         "flex",
            flexDirection:   "column",
            gap:             "var(--space-4)",
            padding:         "var(--space-5)",
            backgroundColor: "var(--color-surface)",
            borderRadius:    "var(--radius-lg)",
            border:          "1px solid var(--color-pending-border)",
          }}
        >
          <p style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-pending-text)" }}>
            This case is waiting for your review.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
            <ActionButton
              variant="primary"
              label="Approve this case"
              onClick={() => setModal("approve")}
            />
            <ActionButton
              variant="secondary"
              label="Reject and send back"
              onClick={() => setModal("reject")}
            />
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {modal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={modal === "approve" ? "Confirm approval" : "Reject case"}
          style={{
            position:        "fixed" as const,
            inset:           0,
            display:         "flex",
            alignItems:      "center",
            justifyContent:  "center",
            padding:         "var(--space-6)",
            backgroundColor: "rgba(0,0,0,0.6)",
            zIndex:          "var(--z-modal)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div
            style={{
              width:           "100%",
              maxWidth:        "480px",
              backgroundColor: "var(--color-surface)",
              borderRadius:    "var(--radius-xl)",
              border:          "1px solid var(--color-border)",
              padding:         "var(--space-6)",
              display:         "flex",
              flexDirection:   "column",
              gap:             "var(--space-5)",
              boxShadow:       "var(--shadow-xl)",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: "var(--font-weight-bold)", color: "var(--color-text-primary)" }}>
              {modal === "approve" ? "Approve this case?" : "Send this case back?"}
            </h2>

            <p style={{ margin: 0, fontSize: "var(--text-base)", color: "var(--color-text-secondary)", lineHeight: "var(--leading-relaxed)" }}>
              {modal === "approve"
                ? "Are you sure you want to approve this case? This cannot be undone."
                : "The importer will be notified and can resubmit once corrections are made."}
            </p>

            {/* Reviewer fields */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div>
                <label htmlFor="reviewer-name" style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-secondary)", marginBottom: "6px" }}>
                  Your name
                </label>
                <input
                  id="reviewer-name"
                  type="text"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="reviewer-email" style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-secondary)", marginBottom: "6px" }}>
                  Your email address
                </label>
                <input
                  id="reviewer-email"
                  type="email"
                  value={reviewerEmail}
                  onChange={(e) => setReviewerEmail(e.target.value)}
                  style={inputStyle}
                />
              </div>

              {modal === "reject" && (
                <div>
                  <label htmlFor="reject-reason" style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-secondary)", marginBottom: "6px" }}>
                    Reason for rejection <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span>
                  </label>
                  <textarea
                    id="reject-reason"
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Explain what needs to be corrected…"
                    style={inputStyle}
                  />
                </div>
              )}
            </div>

            {/* Modal actions */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
              <ActionButton
                variant="secondary"
                label="Cancel"
                onClick={() => setModal(null)}
                disabled={isSubmitting}
              />
              <ActionButton
                variant="primary"
                label={
                  isSubmitting
                    ? "Saving…"
                    : modal === "approve"
                      ? "Confirm approval"
                      : "Send back"
                }
                onClick={handleReviewSubmit}
                disabled={
                  isSubmitting ||
                  !reviewerName.trim() ||
                  !reviewerEmail.trim() ||
                  (modal === "reject" && !rejectReason.trim())
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Dashboard router (reads searchParams — must be inside Suspense)
══════════════════════════════════════════════════════════════════════════════ */

function Dashboard() {
  const router      = useRouter();
  const searchParams = useSearchParams();

  const view     = searchParams.get("view");
  const caseParam = searchParams.get("case");

  /* Silent URL navigation — preserves browser history for back/forward */
  const go = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.push(`/dashboard${qs ? `?${qs}` : ""}`);
    },
    [router, searchParams]
  );

  /* Handle the magic "case" route embedded in onNavigate for HomeView */
  const onHomeNavigate = useCallback(
    (token: string) => {
      if (token.startsWith("__case__")) {
        go({ case: token.replace("__case__", ""), view: null });
      } else {
        go({ view: token, case: null });
      }
    },
    [go]
  );

  /* Case detail overrides ?view */
  if (caseParam) {
    return (
      <CaseDetailView
        caseId={caseParam}
        onBack={() => go({ case: null, view: "cases" })}
      />
    );
  }

  if (view === "upload") {
    return (
      <UploadView
        onBack={() => go({ view: null })}
        onViewCase={(id) => go({ case: id, view: null })}
      />
    );
  }

  if (view === "cases" || view === "review") {
    return (
      <CasesView
        onBack={() => go({ view: null })}
        onSelectCase={(id) => go({ case: id, view: null })}
      />
    );
  }

  return <HomeView onNavigate={onHomeNavigate} />;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Page export — Suspense boundary required for useSearchParams
══════════════════════════════════════════════════════════════════════════════ */

export default function DashboardPage() {
  return (
    <>
      {/* Keyframe for spinner — injected once per page */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <Suspense>
        <Dashboard />
      </Suspense>
    </>
  );
}
