"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUpload } from "@/lib/hooks/useUpload";
import { useAuth } from "@/lib/auth/useAuth";
import { ledgerFetch } from "@/lib/api/client";
import { approveCase } from "@/lib/api/cases";
import type { CaseDetail } from "@/lib/api/types";
import type { ReportPackage } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────────

const UK_ETS_RATE   = 52.4;
const MAX_FILES     = 20;
const MAX_BYTES     = 10 * 1024 * 1024; // 10 MB
const ACCEPT        = ".pdf,.xml,.csv,.xlsx";

/** Rough world-average direct SEE (tCO₂e per tonne) — Annex VI defaults */
const ROUGH_SEE: Record<string, number> = {
  iron_steel:  1.8,
  aluminium:   2.0,
  cement:      0.9,
  fertilisers: 2.5,
  hydrogen:    9.5,
  electricity: 0.4,
};

const STAGE_LINES = [
  "Reading your documents",
  "Extracting data",
  "Calculating emissions",
  "Checking for conflicts",
  "Preparing your report",
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────────

type FileEntry = { id: string; file: File };
type Stage     = 1 | 2 | 3;
type LinePhase = "pending" | "running" | "done";

// ── Helpers ───────────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024)         return `${b} B`;
  if (b < 1024 * 1024)  return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style:                 "currency",
    currency:              "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function truncate(s: string, max = 40): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function dominantSector(pkg: ReportPackage): string | undefined {
  let best: string | undefined;
  let bestVal = -1;
  for (const [k, v] of Object.entries(pkg.emissions_by_sector)) {
    if (v > bestVal) { bestVal = v; best = k; }
  }
  return best;
}

// ── Main page ─────────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router      = useRouter();
  const qc          = useQueryClient();
  const { user }    = useAuth();
  const inputRef    = useRef<HTMLInputElement>(null);
  const startRef    = useRef<number>(0);  // timestamp when Stage 2 began

  // Stage
  const [stage,    setStage]    = useState<Stage>(1);
  const [stageKey, setStageKey] = useState(0); // force fade when stage changes
  const [fadeIn,   setFadeIn]   = useState(true);

  // Stage 1 — files
  const [files,    setFiles]    = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Stage 2 — processing lines
  const [lines,    setLines]    = useState<LinePhase[]>(Array(5).fill("pending"));
  const [elapsed,  setElapsed]  = useState(0);

  // Stage 3 — result
  const [caseDetail,  setCaseDetail]  = useState<CaseDetail | null>(null);
  const [report,      setReport]      = useState<ReportPackage | null>(null);
  const [stage3Ready, setStage3Ready] = useState(false);

  const { step, error, upload, reset } = useUpload();

  // ── Document title ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const titles: Record<Stage, string> = {
      1: "Drop your documents",
      2: "Reading your documents",
      3: "Here's what we found",
    };
    document.title = `${titles[stage]} — Nucleos`;
  }, [stage]);

  // ── Transition helper ──────────────────────────────────────────────────────────
  function transitionTo(next: Stage) {
    setFadeIn(false);
    setTimeout(() => {
      setStage(next);
      setStageKey((k) => k + 1);
      setFadeIn(true);
    }, 200);
  }

  // ── File handling ──────────────────────────────────────────────────────────────
  function addFiles(incoming: File[]) {
    const valid = incoming.filter(
      (f) => f.size <= MAX_BYTES && /\.(pdf|xml|csv|xlsx)$/i.test(f.name)
    );
    setFiles((prev) => {
      const existing = new Set(prev.map((e) => e.file.name));
      const novel    = valid.filter((f) => !existing.has(f.name));
      return [...prev, ...novel].slice(0, MAX_FILES).map((f) =>
        "id" in f ? f as unknown as FileEntry : { id: crypto.randomUUID(), file: f }
      );
    });
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((e) => e.id !== id));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = "";
  }

  // ── Stage 2 — drive processing lines from upload step ─────────────────────────

  // Advance a line to "done" and the next to "running"
  const advanceLine = useCallback((idx: number) => {
    setLines((prev) => {
      const next = [...prev];
      if (idx > 0) next[idx - 1] = "done";
      if (idx < next.length) next[idx] = "running";
      return next;
    });
  }, []);

  useEffect(() => {
    if (stage !== 2) return;

    if (step === "uploading") {
      advanceLine(0);
    } else if (step === "extracting") {
      advanceLine(1);
      const t1 = setTimeout(() => advanceLine(2), 4000);
      return () => clearTimeout(t1);
    } else if (step === "creating") {
      advanceLine(3);
      const t2 = setTimeout(() => advanceLine(4), 2000);
      return () => clearTimeout(t2);
    } else if (step === "done") {
      // Mark all complete
      setLines(Array(5).fill("done"));
    } else if (step === "error") {
      setLines(Array(5).fill("pending"));
    }
  }, [step, stage, advanceLine]);

  // Elapsed timer for "taking longer" message
  useEffect(() => {
    if (stage !== 2) return;
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [stage]);

  // ── Transition: Stage 2 done → fetch Stage 3 data ─────────────────────────────
  useEffect(() => {
    if (step !== "done") return;

    async function loadStage3(caseId: string) {
      try {
        const [cd, rp] = await Promise.all([
          ledgerFetch<CaseDetail>(`/api/cbam/cases/${caseId}`),
          ledgerFetch<ReportPackage>(`/api/cbam/cases/${caseId}/report-package`),
        ]);
        setCaseDetail(cd);
        setReport(rp);
      } catch {
        // Report package may not exist yet if pipeline hasn't run
        try {
          const cd = await ledgerFetch<CaseDetail>(`/api/cbam/cases/${caseId}`);
          setCaseDetail(cd);
        } catch { /* ignore */ }
      } finally {
        setStage3Ready(true);
        transitionTo(3);
      }
    }

    // Give the "Preparing your report" line a moment to visually complete
    const t = setTimeout(() => {
      // result.case_id isn't directly accessible here — read from DOM state via a ref
      // The caseId is stored in uploadCaseIdRef
    }, 800);
    return () => clearTimeout(t);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Submit — Stage 1 → 2 ──────────────────────────────────────────────────────
  const caseIdRef = useRef<string>("");

  async function handleProcess() {
    if (files.length === 0) return;

    transitionTo(2);
    setLines(Array(5).fill("pending"));
    setElapsed(0);

    try {
      // Create case with placeholder data — backend fills from document extraction
      const newCase = await ledgerFetch<{ case_id: string; id: string }>(
        "/api/cbam/cases",
        {
          method: "POST",
          body:   JSON.stringify({
            importer_eori:     "PENDING",
            reporting_year:    new Date().getFullYear(),
            reporting_quarter: Math.ceil((new Date().getMonth() + 1) / 3) as 1 | 2 | 3 | 4,
          }),
        }
      );
      const caseId = newCase.case_id ?? newCase.id;
      caseIdRef.current = caseId;

      // Upload primary file through the pipeline
      await upload(files[0].file, caseId);

      // Upload additional files to the same case (best-effort, no blocking)
      for (const { file } of files.slice(1)) {
        const form = new FormData();
        form.append("file", file);
        fetch(`/api-proxy/ledger/api/cases/${caseId}/documents/upload`, {
          method:  "POST",
          headers: { Authorization: `Bearer ${document.cookie.match(/cbam_token=([^;]+)/)?.[1] ?? ""}` },
          body:    form,
        }).catch(() => {});
      }
    } catch {
      // step will be "error" — Stage 2 handles display
    }
  }

  // ── Patch: fetch stage 3 data when step becomes "done" ─────────────────────────
  // (Re-implementation since caseIdRef isn't accessible inside the previous effect)
  const [awaitingStage3, setAwaitingStage3] = useState(false);

  useEffect(() => {
    if (step === "done" && !awaitingStage3 && caseIdRef.current) {
      setAwaitingStage3(true);
      const caseId = caseIdRef.current;

      const t = setTimeout(async () => {
        try {
          const [cd, rp] = await Promise.all([
            ledgerFetch<CaseDetail>(`/api/cbam/cases/${caseId}`),
            ledgerFetch<ReportPackage>(`/api/cbam/cases/${caseId}/report-package`)
              .catch(() => null),
          ]);
          setCaseDetail(cd);
          if (rp) setReport(rp);
        } catch { /* ignore */ }
        setStage3Ready(true);
        setFadeIn(false);
        setTimeout(() => { setStage(3); setFadeIn(true); }, 200);
      }, 900);

      return () => clearTimeout(t);
    }
  }, [step, awaitingStage3]);

  // ── "Add to my return" ─────────────────────────────────────────────────────────
  async function handleAddToReturn() {
    const caseId = caseIdRef.current;
    if (!caseId) { router.push("/"); return; }
    try {
      await approveCase(caseId, {
        reviewer_name:  user?.sub ?? "importer",
        reviewer_email: user?.sub ?? "importer@nucleos",
        comments:       "Approved via upload flow",
      });
    } catch { /* non-blocking */ }
    qc.invalidateQueries({ queryKey: ["cases"] });
    qc.invalidateQueries({ queryKey: ["kpis"] });
    router.push("/");
  }

  // ── Reset ──────────────────────────────────────────────────────────────────────
  function handleReset() {
    reset();
    setStage(1);
    setLines(Array(5).fill("pending"));
    setElapsed(0);
    setCaseDetail(null);
    setReport(null);
    setStage3Ready(false);
    setAwaitingStage3(false);
    caseIdRef.current = "";
    setFadeIn(true);
  }

  // ── Derived Stage 3 values ────────────────────────────────────────────────────
  const humanReviewRequired = caseDetail?.review_status === "pending_review";
  const sector              = report ? dominantSector(report) : undefined;
  const originCountry       = (caseDetail as CaseDetail & { shipments?: { origin_country?: string }[] })
                                ?.shipments?.[0]?.origin_country;
  const totalLiability      = report ? (report.total_kgco2e / 1000) * UK_ETS_RATE : 0;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        maxWidth:  "var(--max-width)",
        margin:    "0 auto",
        padding:   "var(--space-48) var(--space-32)",
      }}
    >
      <div
        key={stageKey}
        style={{
          opacity:    fadeIn ? 1 : 0,
          transition: "opacity 200ms ease",
          maxWidth:   "640px",
        }}
      >

        {/* ══════════════════════ STAGE 1 ══════════════════════ */}
        {stage === 1 && (
          <>
            <h1
              style={{
                fontSize:     "var(--text-lg)",
                fontWeight:   "var(--font-focal)",
                color:        "var(--color-text-primary)",
                marginBottom: "var(--space-8)",
              }}
            >
              Drop your documents
            </h1>
            <p
              style={{
                fontSize:     "var(--text-base)",
                fontWeight:   "var(--font-body)",
                color:        "var(--color-text-secondary)",
                marginBottom: "var(--space-40)",
              }}
            >
              Invoices, mill certificates, customs declarations, spreadsheets
            </p>

            {/* Drop zone */}
            <div
              onDragOver={(e)  => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={()  => setDragOver(false)}
              onDrop={handleDrop}
              onClick={()      => inputRef.current?.click()}
              style={{
                width:           "100%",
                height:          "240px",
                border:          `1px dashed ${dragOver ? "var(--color-navy)" : "var(--color-border)"}`,
                borderRadius:    "8px",
                backgroundColor: dragOver ? "#F5F7FA" : "var(--color-bg)",
                display:         "flex",
                alignItems:      "center",
                justifyContent:  "center",
                cursor:          "pointer",
                transition:      "border-color 150ms ease, background-color 150ms ease",
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                onChange={handleInputChange}
                style={{ display: "none" }}
              />
              <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", pointerEvents: "none" }}>
                {dragOver ? "Release to upload" : "Drop files here, or click to browse"}
              </p>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div style={{ marginTop: "var(--space-16)" }}>
                {files.map((entry, i) => (
                  <div
                    key={entry.id}
                    style={{
                      display:      "flex",
                      alignItems:   "center",
                      padding:      "var(--space-8) 0",
                      borderTop:    i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
                    }}
                  >
                    <p
                      style={{
                        flex:         1,
                        fontSize:     "var(--text-sm)",
                        fontWeight:   "var(--font-body)",
                        color:        "var(--color-text-primary)",
                        margin:       0,
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace:   "nowrap",
                      }}
                    >
                      {truncate(entry.file.name)}
                    </p>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginLeft: "var(--space-16)", whiteSpace: "nowrap" }}>
                      {formatBytes(entry.file.size)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeFile(entry.id); }}
                      style={{
                        marginLeft:  "var(--space-16)",
                        background:  "none",
                        border:      "none",
                        cursor:      "pointer",
                        padding:     "0 4px",
                        fontSize:    "var(--text-sm)",
                        color:       "var(--color-text-tertiary)",
                        fontFamily:  "inherit",
                        lineHeight:  1,
                      }}
                      aria-label="Remove file"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Process button — right-aligned, appears only when files added */}
            {files.length > 0 && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-32)" }}>
                <Button variant="primary" onClick={handleProcess}>
                  Process documents
                </Button>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════ STAGE 2 ══════════════════════ */}
        {stage === 2 && (
          <div style={{ paddingTop: "var(--space-48)" }}>
            {step === "error" && error ? (
              /* Error state */
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-red)" }}>
                Something went wrong.{" "}
                <button
                  onClick={handleReset}
                  style={{
                    background:  "none",
                    border:      "none",
                    padding:     0,
                    cursor:      "pointer",
                    fontSize:    "inherit",
                    fontFamily:  "inherit",
                    color:       "var(--color-red)",
                    textDecoration: "underline",
                  }}
                >
                  Try again →
                </button>
              </p>
            ) : (
              <>
                {/* Five processing lines */}
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-32)" }}>
                  {STAGE_LINES.map((label, i) => {
                    const phase = lines[i];
                    return (
                      <p
                        key={label}
                        style={{
                          margin:     0,
                          fontSize:   "var(--text-base)",
                          fontWeight: phase === "running" ? "var(--font-focal)" : "var(--font-body)",
                          color:
                            phase === "done"    ? "var(--color-text-secondary)" :
                            phase === "running" ? "var(--color-text-primary)"   :
                            "var(--color-text-tertiary)",
                          animation:  phase === "running" ? "pulse 1.2s ease-in-out infinite" : "none",
                        }}
                      >
                        {phase === "done" ? `·  ${label}` : label}
                      </p>
                    );
                  })}
                </div>

                {/* Timing hint */}
                <p
                  style={{
                    marginTop:  "var(--space-48)",
                    fontSize:   "var(--text-sm)",
                    fontWeight: "var(--font-body)",
                    color:      "var(--color-text-tertiary)",
                  }}
                >
                  This usually takes 10–30 seconds
                </p>

                {/* "Taking longer" line — appears after 30s */}
                {elapsed > 30 && (
                  <p
                    style={{
                      marginTop:  "var(--space-16)",
                      fontSize:   "var(--text-sm)",
                      fontWeight: "var(--font-body)",
                      color:      "var(--color-text-tertiary)",
                    }}
                  >
                    Taking a little longer than usual — almost there
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ══════════════════════ STAGE 3 ══════════════════════ */}
        {stage === 3 && (
          <>
            <h1
              style={{
                fontSize:     "var(--text-lg)",
                fontWeight:   "var(--font-focal)",
                color:        "var(--color-text-primary)",
                marginBottom: "var(--space-40)",
              }}
            >
              Here&apos;s what we found
            </h1>

            {!stage3Ready ? (
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)" }}>Loading…</p>
            ) : humanReviewRequired ? (
              /* ── Human review required ── */
              <>
                <div
                  style={{
                    border:          "var(--border-width) solid var(--color-border)",
                    borderLeft:      "3px solid var(--color-amber)",
                    borderRadius:    "0 var(--btn-radius) var(--btn-radius) 0",
                    padding:         "var(--space-24) var(--space-32)",
                    marginBottom:    "var(--space-32)",
                  }}
                >
                  <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", color: "var(--color-amber)", marginBottom: "var(--space-8)" }}>
                    This case needs a manual check
                  </p>
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", margin: 0 }}>
                    Conflicting data was found across your documents. A compliance specialist will review and resolve it before this case can be included in your return.
                  </p>
                </div>

                {/* Dimmed summary preview */}
                <div style={{ opacity: 0.4, pointerEvents: "none" }}>
                  <StageSummary
                    sector={sector}
                    originCountry={originCountry}
                    totalLiability={totalLiability}
                    report={report}
                    onAddToReturn={handleAddToReturn}
                    showCta={false}
                  />
                </div>

                <div style={{ marginTop: "var(--space-32)" }}>
                  <Button variant="secondary" onClick={() => router.push("/")}>
                    Notify me when it&apos;s resolved
                  </Button>
                </div>
              </>
            ) : (
              /* ── Clean result ── */
              <>
                <StageSummary
                  sector={sector}
                  originCountry={originCountry}
                  totalLiability={totalLiability}
                  report={report}
                  onAddToReturn={handleAddToReturn}
                  showCta={true}
                />
              </>
            )}
          </>
        )}

      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.45; }
        }
      `}</style>
    </div>
  );
}

// ── Stage 3 summary sub-component ─────────────────────────────────────────────────

interface StageSummaryProps {
  sector?:          string;
  originCountry?:   string;
  totalLiability:   number;
  report:           ReportPackage | null;
  onAddToReturn:    () => void;
  showCta:          boolean;
}

function StageSummary({ sector, originCountry, totalLiability, report, onAddToReturn, showCta }: StageSummaryProps) {
  const lines = report?.lines ?? [];

  return (
    <>
      {/* Sector + origin */}
      <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
        {[sector ? sectorLabel(sector) : null, originCountry].filter(Boolean).join(" · ") || "—"}
      </p>

      {/* Hero: liability */}
      <p
        style={{
          fontSize:           "var(--text-hero)",
          fontWeight:         "var(--font-focal)",
          color:              "var(--color-navy)",
          letterSpacing:      "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight:         1,
          marginBottom:       "var(--space-8)",
        }}
      >
        {formatGbp(totalLiability)}
      </p>
      <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-40)" }}>
        estimated 2027 liability
      </p>

      {/* Divider */}
      <div style={{ borderTop: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }} />

      {/* Goods lines */}
      {lines.length > 0 && (
        <div style={{ marginBottom: "var(--space-40)" }}>
          {lines.map((line, i) => {
            const see         = ROUGH_SEE[line.sector] ?? 1.5;
            const lineTco2e   = (line.net_mass_kg / 1000) * see;
            const isDefault   = true; // always default at draft stage

            return (
              <div key={line.id}>
                {i > 0 && <div style={{ borderTop: "var(--border-width) solid var(--color-border)", margin: "var(--space-16) 0" }} />}

                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-16)", flexWrap: "wrap" }}>
                  {/* CN code — monospace */}
                  <span
                    style={{
                      fontSize:   "var(--text-xs)",
                      color:      "var(--color-text-tertiary)",
                      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                    }}
                  >
                    {line.cn_code}
                  </span>

                  {/* Description */}
                  <span style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-primary)", flex: 1 }}>
                    {line.description || sectorLabel(line.sector)}
                  </span>

                  {/* Method badge */}
                  <Badge variant="draft">default</Badge>

                  {/* tCO₂e */}
                  <span style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
                    {lineTco2e.toFixed(2)} tCO₂e
                  </span>
                </div>

                {isDefault && (
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginTop: "4px" }}>
                    Using world average — no supplier data.{" "}
                    <Link href={`/supplier-request`} style={{ color: "var(--color-text-secondary)", textDecoration: "underline" }}>
                      Request data →
                    </Link>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CTA */}
      {showCta && (
        <Button variant="primary" onClick={onAddToReturn}>
          Add to my return
        </Button>
      )}
    </>
  );
}

function sectorLabel(s?: string): string {
  const map: Record<string, string> = {
    iron_steel:  "Iron & steel",
    aluminium:   "Aluminium",
    cement:      "Cement",
    fertilisers: "Fertilisers",
    hydrogen:    "Hydrogen",
    electricity: "Electricity",
  };
  return s ? (map[s] ?? s.replace(/_/g, " ")) : "—";
}
