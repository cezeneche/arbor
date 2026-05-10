"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUpload } from "@/lib/hooks/useUpload";
import { useAuth } from "@/lib/auth/useAuth";
import { useCases } from "@/lib/hooks/useCases";
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

// ── Inline scope checker ───────────────────────────────────────────────────────

type ScopeResult = {
  in_scope:                 boolean;
  sector?:                  string | null;
  cn_description?:          string | null;
  reason?:                  string;
  default_see_tco2e_per_t?: number | null;
};

function InlineScopeChecker() {
  const { cases } = useCases();

  const [open,     setOpen]     = useState(false);
  const [code,     setCode]     = useState("");
  const [qty,      setQty]      = useState("");
  const [phase,    setPhase]    = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result,   setResult]   = useState<ScopeResult | null>(null);
  const [visible,  setVisible]  = useState(false);
  const [codeErr,  setCodeErr]  = useState("");
  const [qtyErr,   setQtyErr]   = useState("");
  const [codeFocus, setCodeFocus] = useState(false);
  const [qtyFocus,  setQtyFocus]  = useState(false);
  // Session-only recent checks — cleared on reload
  const [history, setHistory] = useState<Array<{ cn: string; qty: string }>>([]);
  // Responsive — resolved client-side only to avoid hydration mismatch
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  async function runCheck(cn: string, qtyStr: string) {
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
      setHistory(prev => {
        const without = prev.filter(h => h.cn !== cn);
        return [{ cn, qty: qtyStr }, ...without].slice(0, 3);
      });
    } catch {
      setPhase("error");
    }
  }

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    const cn     = code.replace(/\D/g, "").slice(0, 8);
    const qtyNum = Number(qty);
    let valid = true;
    if (!cn)       { setCodeErr("Enter a commodity code"); valid = false; }
    else             setCodeErr("");
    if (!qty.trim())   { setQtyErr("Enter your approximate annual quantity"); valid = false; }
    else if (qtyNum < 1) { setQtyErr("Enter a quantity above zero"); valid = false; }
    else                   setQtyErr("");
    if (!valid) return;
    await runCheck(cn, qty);
  }

  const qtyNum = Number(qty) || 0;
  const cn     = code.replace(/\D/g, "").slice(0, 8);

  // Check if any loaded case has a goods line matching this CN code
  type CaseWithLines = (typeof cases)[0] & { goods_lines?: Array<{ cn_code: string }> };
  const matchedCase = result?.in_scope
    ? (cases as CaseWithLines[]).find(c => c.goods_lines?.some(l => l.cn_code === cn))
    : undefined;

  const liabilityPerTonne =
    result?.default_see_tco2e_per_t != null
      ? result.default_see_tco2e_per_t * UK_ETS_RATE
      : null;
  const annualLiability =
    liabilityPerTonne != null && qtyNum > 0 ? liabilityPerTonne * qtyNum : null;
  const belowThreshold = result !== null && result.in_scope && annualLiability !== null && annualLiability < 50000;

  return (
    <div style={{ marginTop: "var(--space-32)" }}>
      <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", marginBottom: "var(--space-32)" }} />

      {/* Collapsed trigger — entire row is clickable */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none" }}
      >
        <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", margin: 0 }}>
          Not sure if your goods are covered by UK CBAM? Check a commodity code
        </p>
        <svg
          width="16" height="16" viewBox="0 0 16 16"
          fill="none" stroke="var(--color-text-tertiary)"
          strokeWidth="1.5" strokeLinecap="square"
          style={{ flexShrink: 0, marginLeft: "var(--space-8)", transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 150ms ease" }}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </div>

      {/* Expandable panel — grows downward only */}
      <div style={{ overflow: "hidden", maxHeight: open ? "1200px" : "0", transition: "max-height 200ms ease" }}>
        <div style={{ paddingTop: "var(--space-24)" }}>

          <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", marginBottom: "var(--space-16)" }}>
            Is this covered by UK CBAM?
          </p>

          {/* Recent checks chips — session only */}
          {history.length > 0 && (
            <div style={{ display: "flex", gap: "var(--space-8)", marginBottom: "var(--space-16)", flexWrap: "wrap" }}>
              {history.map(h => (
                <button
                  key={h.cn}
                  type="button"
                  onClick={() => { setCode(h.cn); setQty(h.qty); runCheck(h.cn, h.qty); }}
                  style={{
                    fontSize:        "var(--text-xs)",
                    fontWeight:      "var(--font-body)",
                    color:           "var(--color-text-tertiary)",
                    backgroundColor: "var(--color-bg)",
                    border:          "0.5px solid var(--color-border)",
                    borderRadius:    "4px",
                    padding:         "3px 8px",
                    cursor:          "pointer",
                    fontFamily:      "inherit",
                  }}
                >
                  {h.cn}
                </button>
              ))}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleCheck} noValidate>
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "flex-end", gap: "var(--space-8)" }}>

              {/* Field 1 — Commodity code */}
              <div style={{ flex: isMobile ? "none" : 2, width: isMobile ? "100%" : undefined, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-secondary)", marginBottom: "4px", display: "block" }}>Commodity code</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={e => { setCode(e.target.value.replace(/\D/g, "").slice(0, 8)); setCodeErr(""); }}
                  onFocus={() => setCodeFocus(true)}
                  onBlur={() => setCodeFocus(false)}
                  placeholder="e.g. 72082700"
                  autoComplete="off"
                  style={{
                    width:           "100%",
                    height:          "40px",
                    padding:         "0 var(--space-16)",
                    border:          `0.5px solid ${codeErr ? "var(--color-red)" : codeFocus ? "var(--color-navy)" : "var(--color-border)"}`,
                    borderRadius:    "6px",
                    outline:         "none",
                    fontSize:        "var(--text-base)",
                    fontWeight:      "var(--font-body)",
                    fontFamily:      "inherit",
                    color:           "var(--color-text-primary)",
                    backgroundColor: "var(--color-surface)",
                  }}
                />
                {codeErr && (
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: "4px 0 0" }}>{codeErr}</p>
                )}
              </div>

              {/* Field 2 — Annual quantity with "t" suffix */}
              <div style={{ flex: isMobile ? "none" : 1, width: isMobile ? "100%" : undefined, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{
                  fontSize:     "var(--text-xs)",
                  fontWeight:   "var(--font-body)",
                  color:        "var(--color-text-secondary)",
                  marginBottom: "4px",
                  display:      "block",
                }}>Annual ton</span>
                <div style={{
                  display:         "flex",
                  alignItems:      "stretch",
                  height:          "40px",
                  border:          `0.5px solid ${qtyErr ? "var(--color-red)" : qtyFocus ? "var(--color-navy)" : "var(--color-border)"}`,
                  borderRadius:    "6px",
                  backgroundColor: "var(--color-surface)",
                  overflow:        "hidden",
                }}>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={e => { setQty(e.target.value); setQtyErr(""); }}
                    onFocus={() => setQtyFocus(true)}
                    onBlur={() => setQtyFocus(false)}
                    placeholder="e.g. 500"
                    autoComplete="off"
                    style={{
                      flex:            1,
                      height:          "100%",
                      padding:         "0 0 0 var(--space-16)",
                      border:          "none",
                      outline:         "none",
                      fontSize:        "var(--text-base)",
                      fontWeight:      "var(--font-body)",
                      fontFamily:      "inherit",
                      color:           "var(--color-text-primary)",
                      backgroundColor: "transparent",
                      minWidth:        0,
                    }}
                  />
                  <span style={{
                    fontSize:      "var(--text-sm)",
                    fontWeight:    "var(--font-body)",
                    color:         "var(--color-text-tertiary)",
                    alignSelf:     "center",
                    paddingRight:  "12px",
                    flexShrink:    0,
                    pointerEvents: "none",
                    userSelect:    "none",
                  }}>t</span>
                </div>
                {qtyErr && (
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: "4px 0 0" }}>{qtyErr}</p>
                )}
              </div>

              {/* Check button — inline on desktop, hidden on mobile */}
              {!isMobile && (
                <button
                  type="submit"
                  style={{
                    flexShrink:      0,
                    height:          "40px",
                    padding:         "0 24px",
                    border:          "none",
                    borderRadius:    "6px",
                    backgroundColor: "var(--color-navy)",
                    color:           "#FFFFFF",
                    fontSize:        "15px",
                    fontWeight:      500,
                    fontFamily:      "inherit",
                    cursor:          phase === "loading" ? "default" : "pointer",
                    whiteSpace:      "nowrap",
                  }}
                >
                  {phase === "loading" ? "Checking…" : "Check"}
                </button>
              )}
            </div>

            {/* Check button — mobile, full width below fields */}
            {isMobile && (
              <button
                type="submit"
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
            )}
          </form>

          {phase === "error" && (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginTop: "var(--space-8)" }}>
              Unable to check. Please try again.
            </p>
          )}

          {/* Result */}
          {phase === "done" && result && (
            <div style={{ opacity: visible ? 1 : 0, transition: "opacity 150ms ease", marginTop: "var(--space-16)" }}>
              {result.in_scope && !belowThreshold ? (
                <div style={{
                  backgroundColor: "var(--color-surface)",
                  border:          "var(--border-width) solid var(--color-border)",
                  borderLeft:      "3px solid var(--color-navy)",
                  borderRadius:    "0 8px 8px 0",
                  padding:         "var(--space-24)",
                }}>
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-green)", marginBottom: "var(--space-16)" }}>
                    In scope
                  </p>

                  <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-primary)", marginBottom: "var(--space-24)" }}>
                    Your {sectorLabel(result.sector).toLowerCase()} imports will be subject to UK CBAM from January 2027.
                  </p>

                  {annualLiability != null ? (
                    <>
                      <p style={{
                        fontSize:           "var(--text-hero)",
                        fontWeight:         "var(--font-focal)",
                        color:              "var(--color-navy)",
                        letterSpacing:      "var(--tracking-hero)",
                        fontVariantNumeric: "tabular-nums",
                        lineHeight:         "var(--leading-display)",
                        marginBottom:       "var(--space-8)",
                      }}>
                        {formatCurrency(annualLiability)}
                      </p>
                      <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                        estimated annual liability across {qtyNum.toLocaleString("en-GB")} tonnes at default values
                      </p>
                    </>
                  ) : qtyNum === 0 ? (
                    <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                      Enter your annual tonnage above to see whether you fall within scope and estimate your liability.
                    </p>
                  ) : (
                    <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                      No default emissions rate available for this commodity code.
                    </p>
                  )}

                  <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", marginBottom: "var(--space-24)" }} />

                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-tertiary)", marginBottom: "var(--space-24)" }}>
                    UK CBAM applies if your annual imports of these goods exceed £50,000 in value. Below this threshold you will not be required to register.
                  </p>

                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
                    Drop your documents above to calculate your exact liability.
                  </p>
                </div>
              ) : belowThreshold ? (
                <div style={{
                  backgroundColor: "var(--color-surface)",
                  border:          "var(--border-width) solid var(--color-border)",
                  borderLeft:      "3px solid var(--color-green)",
                  borderRadius:    "0 8px 8px 0",
                  padding:         "var(--space-24)",
                }}>
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-green)", marginBottom: "var(--space-16)" }}>
                    Not in scope
                  </p>

                  <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-primary)", marginBottom: "var(--space-24)" }}>
                    Your {sectorLabel(result.sector).toLowerCase()} imports will not be subject to UK CBAM from January 2027.
                  </p>

                  {annualLiability != null && (
                    <>
                      <p style={{
                        fontSize:           "var(--text-hero)",
                        fontWeight:         "var(--font-focal)",
                        color:              "var(--color-navy)",
                        letterSpacing:      "var(--tracking-hero)",
                        fontVariantNumeric: "tabular-nums",
                        lineHeight:         "var(--leading-display)",
                        marginBottom:       "var(--space-8)",
                      }}>
                        {formatCurrency(annualLiability)}
                      </p>
                      <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                        estimated annual liability across {qtyNum.toLocaleString("en-GB")} tonnes at default values
                      </p>
                    </>
                  )}

                  <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", marginBottom: "var(--space-24)" }} />

                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-tertiary)", marginBottom: "var(--space-24)" }}>
                    UK CBAM applies if your annual imports of these goods exceed £50,000 in value. Below this threshold you will not be required to register.
                  </p>

                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
                    Drop your documents above to calculate your exact liability.
                  </p>
                </div>
              ) : (
                <div style={{
                  backgroundColor: "var(--color-surface)",
                  border:          "var(--border-width) solid var(--color-border)",
                  borderLeft:      "3px solid var(--color-green)",
                  borderRadius:    "0 8px 8px 0",
                  padding:         "var(--space-24)",
                }}>
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-green)", marginBottom: "12px" }}>
                    Not in scope
                  </p>
                  <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
                    {result.reason ?? "This commodity code is not covered by UK CBAM."}{" "}
                    You will not be subject to UK CBAM from January 2027.
                  </p>
                </div>
              )}

              {/* Existing case match */}
              {matchedCase && (
                <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-amber)", marginTop: "var(--space-16)" }}>
                  You already have a case for this commodity.{" "}
                  <Link href={`/cases/${matchedCase.id}`} style={{ color: "var(--color-amber)", textDecoration: "underline" }}>
                    View case →
                  </Link>
                </p>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
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

  const { step, result, error, upload, reset } = useUpload();

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
    if (step === "uploading") { advanceLine(0); }
    else if (step === "processing") {
      // Bytes sent — server now extracting and building the draft
      advanceLine(1);
      const t1 = setTimeout(() => advanceLine(2), 3_000);
      const t2 = setTimeout(() => advanceLine(3), 6_000);
      const t3 = setTimeout(() => advanceLine(4), 9_000);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
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
    if (step !== "done" || fetching3) return;
    const caseId = result?.created?.case_id;
    if (!caseId) return;

    setFetching3(true);
    caseIdRef.current = caseId;

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
  }, [step, fetching3, result]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Submit: Stage 1 → 2 ───────────────────────────────────────────────────────
  async function handleProcess() {
    if (files.length === 0) return;

    transitionTo(2);
    setLines(Array(5).fill("pending"));
    setElapsed(0);

    try {
      // Primary file: upload + extract + create CBAM draft in one request
      const draft = await upload(files[0].file);
      const caseId = draft?.created?.case_id;

      // Additional files: best-effort upload to CBAM document endpoint, non-blocking
      if (caseId) {
        const token = document.cookie.match(/cbam_token=([^;]+)/)?.[1] ?? "";
        for (const { file } of files.slice(1)) {
          const form = new FormData();
          form.append("file", file);
          fetch(`/api-proxy/ledger/api/cbam/cases/${caseId}/documents`, {
            method:  "POST",
            headers: { Authorization: `Bearer ${token}` },
            body:    form,
          }).catch(() => {});
        }
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
          maxWidth:   stage === 1 ? "100%" : "640px",
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

            {/* Inline scope checker — below the drop zone, Stage 1 only */}
            <InlineScopeChecker />
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
      <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-40)" }}>
        estimated 2027 liability
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
