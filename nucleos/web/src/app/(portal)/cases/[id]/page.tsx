"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCase } from "@/lib/hooks/useCases";
import { useAuth } from "@/lib/auth/useAuth";
import { useRole } from "@/lib/auth/useRole";
import { approveCase, rejectCase } from "@/lib/api/cases";
import { ledgerFetch } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import AlertBanner from "@/components/ui/AlertBanner";
import { formatCurrency, toStatusVariant, statusLabel } from "@/lib/design-system";
import { sectorLabel } from "@/lib/constants";
import { DocumentFieldsForm } from "./_components/DocumentFieldsForm";
import { EmissionsTab }      from "./_components/EmissionsTab";
import { AuditTrailTab }     from "./_components/AuditTrailTab";
import { SettingsTab }       from "./_components/SettingsTab";
import { UK_CBAM_RATES, ROUGH_SEE, SectionLabel, Divider, fmtDate } from "./_components/shared";
import type { RichGoodsLine } from "@/lib/api/types";

type ActiveTab = "details" | "emissions" | "audit" | "settings";

export default function CaseDetailPage({ params }: { params: { id: string } }) {
  const { id }        = params;
  const { user }      = useAuth();
  const role          = useRole();
  const isAdmin       = role === "admin";
  const router        = useRouter();
  const queryClient   = useQueryClient();

  const { case_, isLoading, error } = useCase(id);

  const goodsLineIds = (case_?.goods_lines ?? []).map(gl => gl.id);
  const { data: cprClaimsByLine } = useQuery({
    queryKey: ["cpr-claims", id, goodsLineIds.join(",")],
    queryFn: () => Promise.all(
      goodsLineIds.map(glId =>
        ledgerFetch<{ claims: Array<{ cpr_amount_gbp: string }> }>(
          `/api/cbam/cpr/claims/${glId}`
        ).catch(() => ({ claims: [] }))
      )
    ),
    enabled: goodsLineIds.length > 0,
    staleTime: 30_000,
  });

  const [activeTab,        setActiveTab]        = useState<ActiveTab>("details");
  const [actionDone,       setActionDone]        = useState<"approved" | "flagged" | null>(null);
  const [showFlagForm,     setShowFlagForm]      = useState(false);
  const [flagText,         setFlagText]          = useState("");
  const [actioning,        setActioning]         = useState(false);
  const [unseenAuditCount, setUnseenAuditCount]  = useState(0);
  const [downloadingReturn, setDownloadingReturn] = useState(false);
  const [downloadError,     setDownloadError]     = useState<string | null>(null);
  const [actionError,       setActionError]       = useState<string | null>(null);

  const actorName = user?.name ?? user?.sub ?? "unknown";

  function handleTabClick(tab: ActiveTab) {
    setActiveTab(tab);
    if (tab === "audit") setUnseenAuditCount(0);
  }

  const handleSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["audit-log", id] });
    queryClient.invalidateQueries({ queryKey: ["case", id] });
    queryClient.invalidateQueries({ queryKey: ["cases"] });
    setUnseenAuditCount(c => c + 1);
  }, [queryClient, id]);

  if (isLoading) {
    return (
      <div className="page-content" style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}>
        <div>
          <div style={{ paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
            <Skeleton height={14} width={80} style={{ marginBottom: "var(--space-40)" }} />
            <Skeleton height={24} width={200} style={{ marginBottom: "var(--space-8)" }} />
            <Skeleton height={13} width={280} style={{ marginBottom: "var(--space-8)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-32)", paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
            {[0, 1, 2].map(i => (
              <div key={i}>
                <Skeleton height={11} width={80} style={{ marginBottom: "var(--space-8)" }} />
                <Skeleton height={24} width={120} />
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-16)" }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i}>
                <Skeleton height={11} width={100} style={{ marginBottom: "6px" }} />
                <Skeleton height={40} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !case_) {
    return (
      <div className="page-content" style={{ paddingTop: "var(--space-48)" }}>
        <Link href="/" style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "inline-block", marginBottom: "var(--space-40)" }}>
          ← Cases
        </Link>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>
          {error?.message ?? "Case not found."}
        </p>
      </div>
    );
  }

  const goods_lines = (case_.goods_lines ?? []) as RichGoodsLine[];

  const sector     = goods_lines[0]?.sector ? sectorLabel(goods_lines[0].sector) : "—";
  const country    = (case_.shipments?.[0] as { origin_country?: string })?.origin_country ?? goods_lines[0]?.origin_country ?? "—";
  const importDate = (case_.shipments?.[0] as { import_date?: string })?.import_date ?? goods_lines[0]?.import_date ?? case_.created_at;

  const cbamCharge = goods_lines.reduce((sum, gl) => {
    const kg       = gl.net_mass_kg ?? gl.quantity ?? 0;
    const see      = ROUGH_SEE[gl.sector ?? ""] ?? 1.5;
    const directKg = gl.direct_kgco2e ?? (kg > 0 ? (kg / 1000) * see * 1000 : 0);
    const rate     = UK_CBAM_RATES[gl.sector ?? ""] ?? UK_CBAM_RATES["iron_steel"];
    return sum + (directKg / 1000) * rate;
  }, 0);
  const totalCpr = (cprClaimsByLine ?? []).reduce((sum, r) => {
    const latest = r.claims[0];
    return sum + (latest ? parseFloat(latest.cpr_amount_gbp) : 0);
  }, 0);
  const netLiability = Math.max(cbamCharge - totalCpr, 0);

  const isProcessing = case_.status === "processing";
  const isError      = case_.status === "error";
  const isPending    = case_.review_status === "pending_review";
  const isApproved   = case_.review_status === "approved" || case_.status === "signed_off";

  const STAGE_LABELS: Record<string, string> = {
    uploading:         "Uploading document...",
    reading_document:  "Reading document — OCR in progress...",
    extracting_fields: "Extracting CBAM fields...",
    refining:          "Refining extraction...",
    saving:            "Creating case records...",
  };
  const processingStage = (case_ as { processing_stage?: string | null }).processing_stage;
  const processingError = (case_ as { processing_error?: string | null }).processing_error;
  const processingMessage = processingStage && STAGE_LABELS[processingStage]
    ? STAGE_LABELS[processingStage]
    : "Extracting fields from your document — this page will update automatically when complete.";

  function refreshAll() {
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["case", id] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log", id] });
      setUnseenAuditCount(c => c + 1);
      router.refresh();
    }, 1000);
  }

  async function handleDownloadHmrcReturn() {
    setDownloadingReturn(true);
    setDownloadError(null);
    try {
      const tokenMatch = document.cookie.match(/(?:^|;\s*)cbam_token=([^;]+)/);
      const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : (localStorage.getItem("cbam_token") ?? "");
      const res = await fetch(`/api-proxy/ledger/api/cases/${id}/hmrc-return`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          importer_vat_number: (case_ as { importer_vat_number?: string })?.importer_vat_number ?? "",
          importer_address:    (case_ as { importer_address?: Record<string, string> })?.importer_address ?? { line1: "", city: "", postcode: "" },
          accuracy_declaration: true,
        }),
      });
      if (!res.ok) {
        throw new Error(`Download failed (${res.status}). Confirm the importer VAT number and address are set before downloading.`);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `hmrc-return-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed. Please try again.");
    } finally {
      setDownloadingReturn(false);
    }
  }

  async function handleApprove() {
    setActioning(true);
    setActionError(null);
    try {
      await approveCase(id, { reviewer_name: user?.sub ?? "reviewer", reviewer_email: user?.sub ?? "reviewer@nucleos", comments: "Approved via case detail" });
      setActionDone("approved");
      refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Approve failed. Please try again.");
    } finally {
      setActioning(false);
    }
  }

  async function handleSendFlag() {
    if (!flagText.trim()) return;
    setActioning(true);
    setActionError(null);
    try {
      await rejectCase(id, { reviewer_name: user?.sub ?? "reviewer", reviewer_email: user?.sub ?? "reviewer@nucleos", comments: flagText.trim() });
      setActionDone("flagged");
      refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Flagging the case failed. Please try again.");
    } finally {
      setActioning(false);
    }
  }

  const TABS: { key: ActiveTab; label: string }[] = [
    { key: "details",   label: "Details"     },
    { key: "emissions", label: "Emissions"   },
    { key: "audit",     label: "Audit chain" },
    { key: "settings",  label: "Settings"    },
  ];

  return (
    <div className="page-content" style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}>
      <div>

        {case_.load_error && (
          <AlertBanner variant="amber" message={case_.load_error} />
        )}

        {/* ══ HEADER ══ */}
        <div style={{ paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
          <Link href="/" style={{ display: "inline-block", fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", textDecoration: "none", marginBottom: "var(--space-40)" }}>
            ← Cases
          </Link>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-24)" }}>
            <div>
              <p style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", marginBottom: "var(--space-8)" }}>
                {sector !== "—" ? `${sector} · ${country}` : case_.importer_name || "Untitled case"}
              </p>
              <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
                <span style={{ color: "var(--color-text-tertiary)" }}>Case ID: </span>{case_.id}
              </p>
              <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
                {fmtDate(importDate)}
              </p>
            </div>
            <Badge variant={toStatusVariant(case_.status)}>
              {statusLabel(case_.status)}
            </Badge>
          </div>
        </div>


        {/* ══ FINANCIAL SUMMARY ══ */}
        <div style={{ paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-32)" }}>
            <div>
              <SectionLabel>CBAM charge</SectionLabel>
              <p style={{ marginTop: "var(--space-8)", fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: isProcessing ? "var(--color-text-tertiary)" : "var(--color-navy)", fontVariantNumeric: "tabular-nums" }}>
                {isProcessing ? "—" : formatCurrency(cbamCharge)}
              </p>
              {!isProcessing && goods_lines.some(gl => gl.direct_kgco2e == null) && (
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", marginTop: "4px" }}>Annex VI default</p>
              )}
              {!isProcessing && (
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", marginTop: "4px" }}>
                  Rate: engineering estimate — HMRC has not yet published Q1 2027 operative rates
                </p>
              )}
            </div>
            <div>
              <SectionLabel>Carbon price relief</SectionLabel>
              <p style={{ marginTop: "var(--space-8)", fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                {isProcessing ? "—" : formatCurrency(totalCpr)}
              </p>
            </div>
            <div>
              <SectionLabel>Net liability</SectionLabel>
              <p style={{ marginTop: "var(--space-8)", fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: isProcessing ? "var(--color-text-tertiary)" : "var(--color-navy)", fontVariantNumeric: "tabular-nums" }}>
                {isProcessing ? "—" : formatCurrency(netLiability)}
              </p>
            </div>
          </div>
        </div>

        {/* ══ TABS ══ */}
        <div style={{ display: "flex", gap: "var(--space-32)", marginBottom: "var(--space-32)", borderBottom: "var(--border-width) solid var(--color-border)" }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleTabClick(tab.key)}
              style={{
                paddingBottom: "var(--space-12)",
                fontSize:      "var(--text-sm)",
                fontWeight:    activeTab === tab.key ? "var(--font-focal)" : "var(--font-body)",
                color:         activeTab === tab.key ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                background:    "none", border: "none",
                borderBottom:  activeTab === tab.key ? "2px solid var(--color-navy)" : "2px solid transparent",
                marginBottom:  "-1px", cursor: "pointer", fontFamily: "inherit",
                transition:    "color 100ms",
                position:      "relative",
              }}
            >
              {tab.label}
              {tab.key === "audit" && unseenAuditCount > 0 && activeTab !== "audit" && (
                <span style={{ position: "absolute", top: "2px", right: "-10px", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-red)" }} />
              )}
            </button>
          ))}
        </div>

        {/* ══ DETAILS TAB ══ */}
        {activeTab === "details" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-24)", marginBottom: "var(--space-40)" }}>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>Sector</p>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: 0 }}>{sector}</p>
              </div>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>Country of origin</p>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: 0 }}>{country}</p>
              </div>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 300, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>Import date</p>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: 0 }}>{fmtDate(importDate)}</p>
              </div>
            </div>

            <Divider />

            {isError ? (
              <div style={{ paddingBottom: "var(--space-40)" }}>
                <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-red)", marginBottom: "var(--space-8)" }}>
                  Processing failed
                </p>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: 0 }}>
                  {processingError ?? "The document could not be processed. Please upload it again — if it is a scanned image, it may take longer on first attempt."}
                </p>
              </div>
            ) : isProcessing ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", paddingBottom: "var(--space-40)" }}>
                {processingMessage}
              </p>
            ) : (
              <DocumentFieldsForm case_={case_} actorName={actorName} onSaved={handleSaved} />
            )}

            <Divider />

            <div>
              {actionDone === "approved" && (
                <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-primary)" }}>
                  Case approved. <Link href="/" style={{ color: "var(--color-navy)" }}>← Cases</Link>
                </p>
              )}
              {actionDone === "flagged" && (
                <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>
                  Flag submitted. <Link href="/" style={{ color: "var(--color-text-secondary)" }}>← Cases</Link>
                </p>
              )}
              {!actionDone && !isAdmin && (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  You have view-only access. Contact your admin to approve cases.
                </p>
              )}
              {!actionDone && isAdmin && isPending && (
                <div>
                  <div style={{ display: "flex", gap: "var(--space-16)", flexWrap: "wrap" }}>
                    <Button variant="primary" loading={actioning && !showFlagForm} onClick={handleApprove}>Approve case</Button>
                    <Button variant="secondary" onClick={() => setShowFlagForm(v => !v)}>Flag for review</Button>
                  </div>
                  {actionError && (
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginTop: "var(--space-16)" }}>
                      {actionError}
                    </p>
                  )}
                  {showFlagForm && (
                    <div style={{ marginTop: "var(--space-24)" }}>
                      <textarea
                        rows={3} value={flagText} onChange={e => setFlagText(e.target.value)}
                        placeholder="Describe the issue…"
                        style={{ width: "100%", padding: "var(--space-16)", fontSize: "var(--text-base)", fontWeight: "var(--font-body)", fontFamily: "inherit", color: "var(--color-text-primary)", backgroundColor: "var(--color-surface)", border: "var(--border-width) solid var(--color-border)", borderRadius: "var(--btn-radius)", resize: "vertical", outline: "none", boxSizing: "border-box" }}
                      />
                      <div style={{ marginTop: "var(--space-8)" }}>
                        <Button variant="secondary" loading={actioning && showFlagForm} onClick={handleSendFlag}>Send flag</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!actionDone && isAdmin && isApproved && (
                <div>
                  <Button variant="secondary" loading={downloadingReturn} onClick={handleDownloadHmrcReturn}>
                    Download HMRC return (PDF)
                  </Button>
                  {downloadError && (
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--color-signal)", marginTop: "var(--space-8)" }}>
                      {downloadError}
                    </p>
                  )}
                  <p style={{ marginTop: "var(--space-16)" }}>
                    <a href={`/api-proxy/ledger/api/cases/${id}/eu-xml`} style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textDecoration: "underline" }}>
                      Download EU XML declaration
                    </a>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ EMISSIONS TAB ══ */}
        {activeTab === "emissions" && <EmissionsTab case_={case_} onProvideData={() => setActiveTab("details")} />}

        {/* ══ AUDIT CHAIN TAB ══ */}
        {activeTab === "audit" && (
          <AuditTrailTab
            caseId={id}
            onNewSupplierEvent={() => setUnseenAuditCount(c => c + 1)}
          />
        )}

        {/* ══ SETTINGS TAB ══ */}
        {activeTab === "settings" && <SettingsTab case_={case_} />}

      </div>
    </div>
  );
}
