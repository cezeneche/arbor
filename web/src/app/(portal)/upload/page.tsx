"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useUpload } from "@/lib/hooks/useUpload";
import { useCases } from "@/lib/hooks/useCases";
import { ApiError } from "@/lib/api/client";
import { formatCurrency } from "@/lib/design-system";
import { UK_ETS_RATE, sectorLabel } from "@/lib/constants";

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_FILES   = 20;
const MAX_BYTES   = 10 * 1024 * 1024;
const ACCEPT      = ".pdf,.xml,.csv,.xlsx";

// ── Types ──────────────────────────────────────────────────────────────────────

type FileEntry = { id: string; file: File };
type Stage     = 1;

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
  const [history, setHistory] = useState<Array<{ cn: string; qty: string }>>([]);
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
    if (qty.trim() && qtyNum < 1) { setQtyErr("Enter a quantity above zero"); valid = false; }
    else                            setQtyErr("");
    if (!valid) return;
    await runCheck(cn, qty);
  }

  const qtyNum = Number(qty) || 0;
  const cn     = code.replace(/\D/g, "").slice(0, 8);

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

      <div style={{ overflow: "hidden", maxHeight: open ? "1200px" : "0", transition: "max-height 200ms ease" }}>
        <div style={{ paddingTop: "var(--space-24)" }}>

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

          <form onSubmit={handleCheck} noValidate>
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "flex-end", gap: "var(--space-8)" }}>

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
                {codeErr && <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: "4px 0 0" }}>{codeErr}</p>}
              </div>

              <div style={{ flex: isMobile ? "none" : 1, width: isMobile ? "100%" : undefined, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "4px", display: "block" }}>Annual ton (optional)</span>
                <div style={{ display: "flex", alignItems: "stretch", height: "40px", border: `0.5px solid ${qtyErr ? "var(--color-red)" : qtyFocus ? "var(--color-navy)" : "var(--color-border)"}`, borderRadius: "6px", backgroundColor: "var(--color-surface)", overflow: "hidden" }}>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={e => { setQty(e.target.value); setQtyErr(""); }}
                    onFocus={() => setQtyFocus(true)}
                    onBlur={() => setQtyFocus(false)}
                    placeholder="e.g. 500"
                    autoComplete="off"
                    style={{ flex: 1, height: "100%", padding: "0 0 0 var(--space-16)", border: "none", outline: "none", fontSize: "var(--text-base)", fontWeight: "var(--font-body)", fontFamily: "inherit", color: "var(--color-text-primary)", backgroundColor: "transparent", minWidth: 0 }}
                  />
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-tertiary)", alignSelf: "center", paddingRight: "12px", flexShrink: 0, pointerEvents: "none", userSelect: "none" }}>t</span>
                </div>
                {qtyErr && <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: "4px 0 0" }}>{qtyErr}</p>}
              </div>

              {!isMobile && (
                <button type="submit" style={{ flexShrink: 0, height: "40px", padding: "0 24px", border: "none", borderRadius: "6px", backgroundColor: "var(--color-navy)", color: "#FFFFFF", fontSize: "15px", fontWeight: 500, fontFamily: "inherit", cursor: phase === "loading" ? "default" : "pointer", whiteSpace: "nowrap" }}>
                  {phase === "loading" ? "Checking…" : "Check"}
                </button>
              )}
            </div>

            {isMobile && (
              <button type="submit" style={{ width: "100%", height: "40px", marginTop: "8px", border: "none", borderRadius: "6px", backgroundColor: "var(--color-navy)", color: "#FFFFFF", fontSize: "15px", fontWeight: 500, fontFamily: "inherit", cursor: phase === "loading" ? "default" : "pointer" }}>
                {phase === "loading" ? "Checking…" : "Check"}
              </button>
            )}
          </form>

          {phase === "error" && (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginTop: "var(--space-8)" }}>
              Unable to check. Please try again.
            </p>
          )}

          {phase === "done" && result && (
            <div style={{ opacity: visible ? 1 : 0, transition: "opacity 150ms ease", marginTop: "var(--space-16)" }}>
              {result.in_scope && !belowThreshold ? (
                <div style={{ backgroundColor: "var(--color-surface)", border: "var(--border-width) solid var(--color-border)", borderLeft: "3px solid var(--color-navy)", borderRadius: "0 8px 8px 0", padding: "var(--space-24)" }}>
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-green)", marginBottom: "var(--space-16)" }}>
                    {qtyNum === 0 ? "In scope?" : "In scope"}
                  </p>
                  <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-primary)", marginBottom: "var(--space-24)" }}>
                    {qtyNum === 0
                      ? "Enter your annual tonnage above to see whether you fall within scope and estimate your liability."
                      : `Your ${sectorLabel(result.sector).toLowerCase()} imports will be subject to UK CBAM from January 2027.`
                    }
                  </p>
                  {annualLiability != null ? (
                    <>
                      <p style={{ fontSize: "var(--text-hero)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", letterSpacing: "var(--tracking-hero)", fontVariantNumeric: "tabular-nums", lineHeight: "var(--leading-display)", marginBottom: "var(--space-8)" }}>
                        {formatCurrency(annualLiability)}
                      </p>
                      <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                        estimated annual liability across {qtyNum.toLocaleString("en-GB")} tonnes at default values
                      </p>
                    </>
                  ) : qtyNum > 0 ? (
                    <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                      No default emissions rate available for this commodity code.
                    </p>
                  ) : null}
                  <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", marginBottom: "var(--space-24)" }} />
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-tertiary)" }}>
                    UK CBAM applies if your annual imports of these goods exceed £50,000 in value.
                  </p>
                </div>
              ) : belowThreshold ? (
                <div style={{ backgroundColor: "var(--color-surface)", border: "var(--border-width) solid var(--color-border)", borderLeft: "3px solid var(--color-green)", borderRadius: "0 8px 8px 0", padding: "var(--space-24)" }}>
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-green)", marginBottom: "var(--space-16)" }}>Not in scope</p>
                  <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-primary)", marginBottom: "var(--space-24)" }}>
                    Your {sectorLabel(result.sector).toLowerCase()} imports will not be subject to UK CBAM from January 2027.
                  </p>
                  {annualLiability != null && (
                    <>
                      <p style={{ fontSize: "var(--text-hero)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", letterSpacing: "var(--tracking-hero)", fontVariantNumeric: "tabular-nums", lineHeight: "var(--leading-display)", marginBottom: "var(--space-8)" }}>
                        {formatCurrency(annualLiability)}
                      </p>
                      <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-24)" }}>
                        estimated annual liability across {qtyNum.toLocaleString("en-GB")} tonnes at default values
                      </p>
                    </>
                  )}
                  <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", marginBottom: "var(--space-24)" }} />
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-tertiary)" }}>
                    UK CBAM applies if your annual imports of these goods exceed £50,000 in value.
                  </p>
                </div>
              ) : (
                <div style={{ backgroundColor: "var(--color-surface)", border: "var(--border-width) solid var(--color-border)", borderLeft: "3px solid var(--color-green)", borderRadius: "0 8px 8px 0", padding: "var(--space-24)" }}>
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-green)", marginBottom: "12px" }}>Not in scope</p>
                  <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
                    {result.reason ?? "This commodity code is not covered by UK CBAM."}{" "}
                    You will not be subject to UK CBAM from January 2027.
                  </p>
                </div>
              )}

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

// ── Processing bar ─────────────────────────────────────────────────────────────

function ProcessingBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div style={{ marginTop: "var(--space-32)" }}>
      <div style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        marginBottom:   "var(--space-8)",
      }}>
        <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", margin: 0 }}>
          {label}
        </p>
        <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-tertiary)", margin: 0, fontVariantNumeric: "tabular-nums" }}>
          {pct}%
        </p>
      </div>
      <div style={{
        width:           "100%",
        height:          "3px",
        backgroundColor: "var(--color-border)",
        borderRadius:    "2px",
        overflow:        "hidden",
      }}>
        <div style={{
          height:          "100%",
          width:           `${pct}%`,
          backgroundColor: "var(--color-navy)",
          borderRadius:    "2px",
          transition:      "width 600ms cubic-bezier(0.4, 0, 0.2, 1)",
        }} />
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router   = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage,    setStage]    = useState<Stage>(1);
  const [fadeIn,   setFadeIn]   = useState(true);
  const [stageKey, setStageKey] = useState(0);

  // Stage 1 state
  const [files,       setFiles]       = useState<FileEntry[]>([]);
  const [dragOver,    setDragOver]    = useState(false);
  const [isProcessing,   setIsProcessing]   = useState(false);
  const [processingPct,  setProcessingPct]  = useState(0);
  const [processingLabel, setProcessingLabel] = useState("Uploading...");
  const [processError,   setProcessError]   = useState<string | null>(null);

  const { step, error, upload, reset } = useUpload();

  useEffect(() => {
    document.title = stage === 1 ? "Upload — Nucleos" : "Here's what we found — Nucleos";
  }, [stage]);

  // Surface upload error inline
  useEffect(() => {
    if (step !== "error" || !error) return;
    setIsProcessing(false);
    setProcessingPct(0);
    const msg =
      error instanceof ApiError && error.status === 413
        ? "File is too large. Please upload a file under 10 MB."
        : error instanceof ApiError && error.status === 422
        ? "We couldn't extract the required data from this document. Please try a PDF invoice, mill certificate, or customs declaration."
        : error instanceof ApiError && error.status === 408
        ? "Processing is taking longer than expected. Please try again — it may work on a second attempt."
        : error instanceof ApiError && error.status === 0
        ? "Upload failed. Please check your internet connection and try again."
        : "Something went wrong processing your document. Please try again.";
    setProcessError(msg);
  }, [step, error]);

  // ── File handling ─────────────────────────────────────────────────────────────
  function addFiles(incoming: File[]) {
    const valid = incoming.filter(
      f => f.size <= MAX_BYTES && /\.(pdf|xml|csv|xlsx)$/i.test(f.name)
    );
    setFiles(prev => {
      const existing = new Set(prev.map(e => e.file.name));
      const novel    = valid.filter(f => !existing.has(f.name));
      return [...prev, ...novel].slice(0, MAX_FILES).map(f =>
        isFileEntry(f) ? f : { id: crypto.randomUUID(), file: f }
      );
    });
  }

  function removeFile(id: string) {
    setFiles(prev => prev.filter(e => e.id !== id));
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

  // ── Submit ────────────────────────────────────────────────────────────────────
  async function handleProcess() {
    if (files.length === 0 || isProcessing) return;

    setIsProcessing(true);
    setProcessingPct(0);
    setProcessingLabel("Uploading...");
    setProcessError(null);

    // Phase 1: animate 0 → 45% while HTTP upload is in flight
    const uploadTick = setInterval(() => {
      setProcessingPct(prev => {
        if (prev >= 45) return prev;
        return Math.round(Math.min(45, prev + Math.max(1, (45 - prev) * 0.12)));
      });
    }, 500);

    const draft = await upload(files[0].file);
    clearInterval(uploadTick);

    if (!draft) return; // error handled by the error useEffect below

    const caseId = draft.created?.case_id;
    const token  = document.cookie.match(/cbam_token=([^;]+)/)?.[1] ?? "";

    if (caseId) {
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

    if (!caseId) {
      setProcessingPct(100);
      setTimeout(() => router.push("/"), 600);
      return;
    }

    // Phase 2: jump to 50%, then poll until extraction completes
    setProcessingPct(50);
    setProcessingLabel(`Reading ${files[0].file.name}…`);

    const STAGE_LABELS: Record<string, string> = {
      uploading:         "Uploading...",
      reading_document:  "Reading document...",
      extracting_fields: "Extracting fields...",
      refining:          "Refining extraction...",
      saving:            "Creating case...",
    };

    while (true) {
      await new Promise<void>(r => setTimeout(r, 1_500));

      // Slowly advance toward 99% while waiting
      setProcessingPct(prev => Math.round(Math.min(99, prev + Math.max(0.5, (99 - prev) * 0.06))));

      try {
        const res = await fetch(`/api-proxy/ledger/api/cbam/cases/${caseId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const caseData = await res.json() as {
            status: string;
            processing_stage?: string | null;
            processing_error?: string | null;
          };

          if (caseData.processing_stage && STAGE_LABELS[caseData.processing_stage]) {
            setProcessingLabel(STAGE_LABELS[caseData.processing_stage]);
          }

          if (caseData.status === "error") {
            setIsProcessing(false);
            setProcessingPct(0);
            setProcessError(
              caseData.processing_error
                ?? "Processing failed. Please try again — if the document is a scanned image it may take longer."
            );
            return;
          }

          if (caseData.status !== "processing") {
            setProcessingPct(100);
            setTimeout(() => router.push(`/cases/${caseId}`), 600);
            return;
          }
        }
      } catch {
        // transient network error — keep polling
      }
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────────
  function handleReset() {
    reset();
    setStage(1);
    setStageKey(k => k + 1);
    setIsProcessing(false);
    setProcessingPct(0);
    setProcessError(null);
    setFiles([]);
    setFadeIn(true);
  }

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

        {/* ══════════════════════════ STAGE 1 — Upload ══════════════════════════ */}
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

            {/* Drop zone — locked while processing */}
            <div
              onDragOver={isProcessing ? undefined : (e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={isProcessing ? undefined : () => setDragOver(false)}
              onDrop={isProcessing ? undefined : handleDrop}
              onClick={isProcessing ? undefined : () => inputRef.current?.click()}
              style={{
                width:           "100%",
                height:          "240px",
                border:          `1px dashed ${dragOver ? "var(--color-navy)" : "var(--color-border)"}`,
                borderRadius:    "8px",
                backgroundColor: dragOver ? "#F5F7FA" : "var(--color-bg)",
                display:         "flex",
                alignItems:      "center",
                justifyContent:  "center",
                cursor:          isProcessing ? "default" : "pointer",
                transition:      "border-color 150ms ease, background-color 150ms ease",
                opacity:         isProcessing ? 0.5 : 1,
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                onChange={handleInputChange}
                style={{ display: "none" }}
                disabled={isProcessing}
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
                      display:    "flex",
                      alignItems: "center",
                      padding:    "var(--space-8) 0",
                      borderTop:  i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
                      opacity:    isProcessing ? 0.6 : 1,
                    }}
                  >
                    <p style={{ flex: 1, fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {truncate(entry.file.name)}
                    </p>
                    {files.length > 1 && (
                      <span style={{ fontSize: "var(--text-xs)", color: i === 0 ? "var(--color-navy)" : "var(--color-text-tertiary)", marginLeft: "var(--space-8)", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {i === 0 ? "Extracted" : "Attached"}
                      </span>
                    )}
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginLeft: "var(--space-16)", whiteSpace: "nowrap" }}>
                      {formatBytes(entry.file.size)}
                    </span>
                    {!isProcessing && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); removeFile(entry.id); }}
                        aria-label="Remove file"
                        style={{ marginLeft: "var(--space-16)", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", fontFamily: "inherit", lineHeight: 1 }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {files.length > 1 && !isProcessing && (
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: "var(--space-8)", margin: "var(--space-8) 0 0" }}>
                    CBAM fields are extracted from the first document. Additional files are attached to the case.
                  </p>
                )}
              </div>
            )}

            {/* Processing bar — shown while processing */}
            {isProcessing && (
              <ProcessingBar pct={processingPct} label={processingLabel} />
            )}

            {/* Error message */}
            {processError && (
              <div style={{ marginTop: "var(--space-16)" }}>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: "0 0 var(--space-8) 0" }}>
                  {processError}{" "}
                  <button
                    onClick={handleReset}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "inherit", fontFamily: "inherit", color: "var(--color-red)", textDecoration: "underline" }}
                  >
                    Try again →
                  </button>
                </p>
              </div>
            )}

            {/* Process button — only when files added and not yet processing */}
            {files.length > 0 && !isProcessing && !processError && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-32)" }}>
                <Button variant="primary" onClick={handleProcess}>
                  Process document{files.length > 1 ? "s" : ""}
                </Button>
              </div>
            )}

            {/* Inline scope checker — Stage 1 only, hidden while processing */}
            {!isProcessing && <InlineScopeChecker />}
          </>
        )}

      </div>
    </div>
  );
}
