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
import {
  formatCurrency,
  formatEmissions,
  methodBadgeVariant,
  methodLabel,
} from "@/lib/design-system";
import type { CaseDetail } from "@/lib/api/types";
import type { ReportPackage } from "@/lib/types";

// ── Constants ──────────────────────────────────────────────────────────────────

const UK_ETS_RATE = 52.4;
const MAX_FILES   = 20;
const MAX_BYTES   = 10 * 1024 * 1024; // 10 MB
const ACCEPT      = ".pdf,.xml,.csv,.xlsx";

/** Annex VI world-average direct SEE (tCO₂e/t) — used for per-line estimate */
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

// ── Types ──────────────────────────────────────────────────────────────────────

type FileEntry = { id: string; file: File };
type Stage     = 1 | 2 | 3;
type LinePhase = "pending" | "running" | "done";

function isFileEntry(f: FileEntry | File): f is FileEntry {
  return "id" in f && typeof (f as FileEntry).id === "string";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024)        return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
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

function sectorLabel(s: string | null | undefined): string {
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router   = useRouter();
  const qc       = useQueryClient();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const caseIdRef = useRef<string>("");

  // Stage + fade transition
  const [stage,   setStage]   = useState<Stage>(1);
  const [fadeIn,  setFadeIn]  = useState(true);
  const [stageKey, setStageKey] = useState(0);

  // Stage 1 state
  const [files,    setFiles]    = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Stage 2 state
  const [lines,   setLines]   = useState<LinePhase[]>(Array(5).fill("pending"));
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);

  // Stage 3 state
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [report,     setReport]     = useState<ReportPackage | null>(null);
  const [fetching3,  setFetching3]  = useState(false);

  const { step, error, upload, reset } = useUpload();

  // ── Document title ────────────────────────────────────────────────────────────
  useEffect(() => {
    const titles: Record<Stage, string> = {
      1: "Drop your documents",
      2: "Reading your documents",
      3: "Here's what we found",
    };
    document.title = `${titles[stage]} — Nucleos`;
  }, [stage]);

  // ── Transition helper ─────────────────────────────────────────────────────────
  function transitionTo(next: Stage) {
    setFadeIn(false);
    setTimeout(() => {
      setStage(next);
      setStageKey((k) => k + 1);
      setFadeIn(true);
    }, 200);
  }

  // ── File handling ─────────────────────────────────────────────────────────────
  function addFiles(incoming: File[]) {
    const valid = incoming.filter(
      (f) => f.size <= MAX_BYTES && /\.(pdf|xml|csv|xlsx)$/i.test(f.name)
    );
    setFiles((prev) => {
      const existing = new Set(prev.map((e) => e.file.name));
      const novel    = valid.filter((f) => !existing.has(f.name));
      return [...prev, ...novel].slice(0, MAX_FILES).map((f) =>
        isFileEntry(f) ? f : { id: crypto.randomUUID(), file: f }
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

  // ── Stage 2 — advance processing lines from upload step ───────────────────────
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
    if (step === "uploading")  { advanceLine(0); }
    else if (step === "extracting") {
      advanceLine(1);
      const t = setTimeout(() => advanceLine(2), 4_000);
      return () => clearTimeout(t);
    } else if (step === "creating") {
      advanceLine(3);
      const t = setTimeout(() => advanceLine(4), 2_000);
      return () => clearTimeout(t);
    } else if (step === "done")  { setLines(Array(5).fill("done")); }
    else if (step === "error")   { setLines(Array(5).fill("pending")); }
  }, [step, stage, advanceLine]);

  // Elapsed timer — drives "taking longer" line after 30 s
  useEffect(() => {
    if (stage !== 2) return;
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1_000);
    return () => clearInterval(id);
  }, [stage]);

  // ── Fetch Stage 3 data when upload completes ──────────────────────────────────
  useEffect(() => {
    if (step !== "done" || fetching3 || !caseIdRef.current) return;

    setFetching3(true);
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
      } catch { /* show stage 3 with what we have */ }
      transitionTo(3);
    }, 900); // let "Preparing your report" visually complete

    return () => clearTimeout(t);
  }, [step, fetching3]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Submit: Stage 1 → 2 ───────────────────────────────────────────────────────
  async function handleProcess() {
    if (files.length === 0) return;

    transitionTo(2);
    setLines(Array(5).fill("pending"));
    setElapsed(0);

    try {
      const newCase = await ledgerFetch<{ case_id: string; id: string }>(
        "/api/cbam/cases",
        {
          method: "POST",
          body:   JSON.stringify({
            importer_eori:     "PENDING",
            reporting_year:    new Date().getFullYear(),
            reporting_quarter: Math.ceil((new Date().getMonth() + 1) / 3) as 1|2|3|4,
          }),
        }
      );
      const caseId = newCase.case_id ?? newCase.id;
      caseIdRef.current = caseId;

      // Primary file drives the pipeline
      await upload(files[0].file, caseId);

      // Additional files: best-effort upload, non-blocking
      for (const { file } of files.slice(1)) {
        const form = new FormData();
        form.append("file", file);
        fetch(`/api-proxy/ledger/api/cases/${caseId}/documents/upload`, {
          method:  "POST",
          headers: { Authorization: `Bearer ${document.cookie.match(/cbam_token=([^;]+)/)?.[1] ?? ""}` },
          body:    form,
        }).catch(() => {});
      }
    } catch { /* step becomes "error" — Stage 2 handles the display */ }
  }

  // ── Add to return ─────────────────────────────────────────────────────────────
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
    // Return to case detail — not homepage — so the user keeps context
    router.push(`/cases/${caseIdRef.current}`);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────────
  function handleReset() {
    reset();
    setStage(1);
    setStageKey((k) => k + 1);
    setLines(Array(5).fill("pending"));
    setElapsed(0);
    setCaseDetail(null);
    setReport(null);
    setFetching3(false);
    caseIdRef.current = "";
    setFadeIn(true);
  }

  // ── Derived Stage 3 values ────────────────────────────────────────────────────
  const humanReviewRequired = caseDetail?.review_status === "pending_review";
  const sector              = report ? dominantSector(report) : undefined;
  const originCountry       = (caseDetail as CaseDetail & { shipments?: Array<{ origin_country?: string }> })
                                ?.shipments?.[0]?.origin_country;
  const totalLiability      = report ? (report.total_kgco2e / 1000) * UK_ETS_RATE : 0;
  const caseId              = caseIdRef.current;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="page-content"
      style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}
    >
      <div
        key={stageKey}
        style={{
          maxWidth:   "640px",
          opacity:    fadeIn ? 1 : 0,
          transition: "opacity 200ms ease",
        }}
      >

        {/* ══════════════════════════ STAGE 1 ══════════════════════════ */}
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
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
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
              <p
                style={{
                  fontSize:      "var(--text-sm)",
                  fontWeight:    "var(--font-body)",
                  color:         "var(--color-text-secondary)",
                  pointerEvents: "none",
                  margin:        0,
                }}
              >
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
                      display:   "flex",
                      alignItems: "center",
                      padding:   "var(--space-8) 0",
                      borderTop: i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
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
                    <span
                      style={{
                        fontSize:   "var(--text-xs)",
                        color:      "var(--color-text-tertiary)",
                        marginLeft: "var(--space-16)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatBytes(entry.file.size)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeFile(entry.id); }}
                      aria-label="Remove file"
                      style={{
                        marginLeft: "var(--space-16)",
                        background: "none",
                        border:     "none",
                        cursor:     "pointer",
                        padding:    0,
                        fontSize:   "var(--text-sm)",
                        color:      "var(--color-text-tertiary)",
                        fontFamily: "inherit",
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Process button — only when files are added, right-aligned */}
            {files.length > 0 && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-32)" }}>
                <Button variant="primary" onClick={handleProcess}>
                  Process documents
                </Button>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════ STAGE 2 ══════════════════════════ */}
        {stage === 2 && (
          <>
            <h1
              style={{
                fontSize:     "var(--text-lg)",
                fontWeight:   "var(--font-focal)",
                color:        "var(--color-text-primary)",
                marginBottom: "var(--space-40)",
              }}
            >
              Reading your documents
            </h1>

            {step === "error" && error ? (
              /* Error: single line, danger red */
              <p style={{ fontSize: "var(--text-base)", color: "var(--color-red)", margin: 0 }}>
                Something went wrong.{" "}
                <button
                  onClick={handleReset}
                  style={{
                    background:      "none",
                    border:          "none",
                    padding:         0,
                    cursor:          "pointer",
                    fontSize:        "inherit",
                    fontFamily:      "inherit",
                    color:           "var(--color-red)",
                    textDecoration:  "underline",
                  }}
                >
                  Try again →
                </button>
              </p>
            ) : (
              /* Five processing lines */
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
                      }}
                    >
                      {phase === "done" ? `· ${label}` : label}
                    </p>
                  );
                })}

                {/* Sixth line — appears after 30 s */}
                {elapsed > 30 && (
                  <p
                    style={{
                      margin:     0,
                      fontSize:   "var(--text-base)",
                      fontWeight: "var(--font-body)",
                      color:      "var(--color-text-tertiary)",
                    }}
                  >
                    This is taking longer than usual — almost there
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════ STAGE 3 ══════════════════════════ */}
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

            {humanReviewRequired ? (
              <>
                {/* Conflict card */}
                <div
                  style={{
                    border:       "var(--border-width) solid var(--color-border)",
                    borderLeft:   "3px solid var(--color-amber)",
                    borderRadius: "0 var(--btn-radius) var(--btn-radius) 0",
                    padding:      "var(--space-24) var(--space-32)",
                    marginBottom: "var(--space-32)",
                  }}
                >
                  <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", color: "var(--color-amber)", marginBottom: "var(--space-8)" }}>
                    This case needs a manual check
                  </p>
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", margin: 0 }}>
                    Conflicting data was found across your documents. A compliance specialist will review and resolve it before this case can be included in your return.
                  </p>
                </div>

                {/* Greyed-out summary preview */}
                <div style={{ opacity: 0.5, pointerEvents: "none" }}>
                  <StageSummary
                    sector={sector}
                    originCountry={originCountry}
                    totalLiability={totalLiability}
                    report={report}
                    caseId={caseId}
                    onAddToReturn={handleAddToReturn}
                    showCta={false}
                  />
                </div>

                <div style={{ marginTop: "var(--space-32)" }}>
                  <Button variant="secondary" onClick={() => router.push(`/cases/${caseIdRef.current}`)}>
                    I&apos;ll sort this — notify me when it&apos;s resolved
                  </Button>
                </div>
              </>
            ) : (
              /* Clean result */
              <StageSummary
                sector={sector}
                originCountry={originCountry}
                totalLiability={totalLiability}
                report={report}
                caseId={caseId}
                onAddToReturn={handleAddToReturn}
                showCta={true}
              />
            )}
          </>
        )}

      </div>
    </div>
  );
}

// ── Stage 3 summary ────────────────────────────────────────────────────────────

interface StageSummaryProps {
  sector?:        string;
  originCountry?: string;
  totalLiability: number;
  report:         ReportPackage | null;
  caseId:         string;
  onAddToReturn:  () => void;
  showCta:        boolean;
}

function StageSummary({
  sector,
  originCountry,
  totalLiability,
  report,
  caseId,
  onAddToReturn,
  showCta,
}: StageSummaryProps) {
  const lines = report?.lines ?? [];

  return (
    <>
      {/* Sector + origin */}
      <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
        {[sector ? sectorLabel(sector) : null, originCountry].filter(Boolean).join(" · ") || "—"}
      </p>

      {/* Hero: liability — always estimated at upload stage (default SEE values) */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "var(--space-8)" }}>
        <Badge variant="pending">Estimated</Badge>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontWeight: "var(--font-body)" }}>
          based on world-average default values
        </span>
      </div>
      <p
        style={{
          fontSize:           "var(--text-hero)",
          fontWeight:         "var(--font-focal)",
          color:              "var(--color-navy)",
          letterSpacing:      "var(--tracking-hero)",
          fontVariantNumeric: "tabular-nums",
          lineHeight:         "var(--leading-display)",
          marginBottom:       "var(--space-8)",
        }}
      >
        {formatCurrency(totalLiability)}
      </p>
      <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
        estimated 2027 liability
      </p>
      {/* Tagline — appears only after the number has been shown, not before */}
      <p style={{ fontSize: "var(--text-xs)", fontWeight: "var(--font-body)", color: "var(--color-text-tertiary)", marginBottom: "var(--space-40)", letterSpacing: "0.04em" }}>
        Your number. Confirmed.
      </p>

      {/* Divider */}
      <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", marginBottom: "var(--space-40)" }} />

      {/* Goods lines */}
      {lines.length > 0 && (
        <div style={{ marginBottom: "var(--space-40)" }}>
          {lines.map((line, i) => {
            const see       = ROUGH_SEE[line.sector] ?? 1.5;
            const kgco2e    = (line.net_mass_kg / 1000) * see * 1000;
            // Upload flow produces draft cases that always use default SEE values
            const isDefault = true;

            return (
              <div key={line.id}>
                {i > 0 && (
                  <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", margin: "var(--space-16) 0" }} />
                )}

                {/* CN code · description · method badge · tCO₂e */}
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-16)", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize:   "var(--text-xs)",
                      color:      "var(--color-text-tertiary)",
                      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {line.cn_code}
                  </span>

                  <span
                    style={{
                      fontSize:   "var(--text-base)",
                      fontWeight: "var(--font-body)",
                      color:      "var(--color-text-primary)",
                      flex:       1,
                      minWidth:   0,
                    }}
                  >
                    {line.description || sectorLabel(line.sector)}
                  </span>

                  <Badge variant={isDefault ? "error" : methodBadgeVariant(undefined)}>
                    {isDefault ? "Default value" : methodLabel(undefined)}
                  </Badge>

                  <span
                    style={{
                      fontSize:           "var(--text-base)",
                      fontWeight:         "var(--font-focal)",
                      color:              "var(--color-text-primary)",
                      whiteSpace:         "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatEmissions(kgco2e)}
                  </span>
                </div>

                {/* Default value notice */}
                {isDefault && (
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginTop: "var(--space-8)" }}>
                    No supplier data — using world average.{" "}
                    <Link
                      href={`/supplier-request/${caseId}?cn_code=${encodeURIComponent(line.cn_code)}`}
                      style={{ color: "var(--color-text-secondary)", textDecoration: "underline" }}
                    >
                      Request data →
                    </Link>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CTA — one primary button, nothing else */}
      {showCta && (
        <Button variant="primary" onClick={onAddToReturn}>
          Add to my return
        </Button>
      )}
    </>
  );
}
