"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useCase } from "@/lib/hooks/useCases";
import { useAuth } from "@/lib/auth/useAuth";
import { useRole } from "@/lib/auth/useRole";
import { getAuditLog } from "@/lib/api/audit";
import { approveCase, rejectCase } from "@/lib/api/cases";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
  formatEmissions,
  methodLabel,
  methodBadgeVariant,
} from "@/lib/design-system";
import type { AuditEvent, CBAMGoodsLine } from "@/lib/types";

// ── Constants ──────────────────────────────────────────────────────────────────

const UK_ETS_RATE = 52.4;

/** Annex VI world-average direct SEE (tCO₂e/t) — fallback when no verified emissions */
const ROUGH_SEE: Record<string, number> = {
  iron_steel:  1.8,
  aluminium:   2.0,
  cement:      0.9,
  fertilisers: 2.5,
  hydrogen:    9.5,
  electricity: 0.4,
};

const MONO: React.CSSProperties = {
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function sectorLabel(s?: string): string {
  const map: Record<string, string> = {
    iron_steel: "Iron & steel", aluminium:   "Aluminium",
    cement:     "Cement",       fertilisers: "Fertilisers",
    hydrogen:   "Hydrogen",     electricity: "Electricity",
  };
  return s ? (map[s] ?? s.replace(/_/g, " ")) : "—";
}

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function isChainValid(events: AuditEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    if (events[i].prev_hmac !== events[i - 1].hmac_sha256) return false;
  }
  return true;
}

// ── Section label — only all-caps element in the product ──────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize:      "var(--text-xs)",
        fontWeight:    "var(--font-focal)",
        color:         "var(--color-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        margin:        0,
      }}
    >
      {children}
    </p>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }  = use(params);
  const { user } = useAuth();
  const role     = useRole();
  const isAdmin  = role === "admin";

  const { case_, isLoading, error } = useCase(id);

  const { data: auditEvents = [] } = useQuery<AuditEvent[]>({
    queryKey:  ["audit-log", id],
    queryFn:   () => getAuditLog(id),
    staleTime: 60_000,
    enabled:   Boolean(id),
  });

  // Action state
  const [actionDone,   setActionDone]   = useState<"approved" | "flagged" | null>(null);
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagText,     setFlagText]     = useState("");
  const [actioning,    setActioning]    = useState(false);

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="page-content" style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}>
        <div style={{ maxWidth: "640px" }}>
          {/* Header skeleton */}
          <div style={{ paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
            <Skeleton height={14} width={80} style={{ marginBottom: "var(--space-40)" }} />
            <Skeleton height={24} width={200} style={{ marginBottom: "var(--space-8)" }} />
            <Skeleton height={13} width={280} style={{ marginBottom: "var(--space-8)" }} />
            <Skeleton height={13} width={140} />
          </div>
          {/* Financial skeleton */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-32)", paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Skeleton height={11} width={80} style={{ marginBottom: "var(--space-8)" }} />
                <Skeleton height={24} width={120} />
              </div>
            ))}
          </div>
          {/* Goods lines skeleton */}
          <div style={{ paddingBottom: "var(--space-40)" }}>
            <Skeleton height={11} width={72} style={{ marginBottom: "var(--space-16)" }} />
            <Skeleton height={48} style={{ marginBottom: "var(--space-8)" }} />
            <Skeleton height={48} />
          </div>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────────

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

  // ── Derived values ────────────────────────────────────────────────────────────

  type WithExtras = typeof case_ & {
    shipments?: Array<{ origin_country?: string; import_date?: string }>;
  };
  const c = case_ as WithExtras;

  const sector     = sectorLabel(c.goods_lines?.[0]?.sector);
  const country    = c.shipments?.[0]?.origin_country ?? "—";
  const importDate = c.shipments?.[0]?.import_date ?? c.created_at;

  // Liability calculation — CPR not yet in report package; zero until supported
  const totalKgco2e  = 0; // report package not fetched on this page (fetched via separate hook if needed)
  const cbamCharge   = (totalKgco2e / 1000) * UK_ETS_RATE;
  const cpr          = 0;
  const netLiability = cbamCharge - cpr;

  const chainValid = auditEvents.length === 0 || isChainValid(auditEvents);
  const isPending  = c.review_status === "pending_review";
  const isApproved = c.review_status === "approved" || c.status === "signed_off";

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function handleApprove() {
    setActioning(true);
    try {
      await approveCase(id, {
        reviewer_name:  user?.sub ?? "reviewer",
        reviewer_email: user?.sub ?? "reviewer@nucleos",
        comments:       "Approved via case detail",
      });
      setActionDone("approved");
    } catch { /* state unchanged */ }
    setActioning(false);
  }

  async function handleSendFlag() {
    if (!flagText.trim()) return;
    setActioning(true);
    try {
      await rejectCase(id, {
        reviewer_name:  user?.sub ?? "reviewer",
        reviewer_email: user?.sub ?? "reviewer@nucleos",
        comments:       flagText.trim(),
      });
      setActionDone("flagged");
    } catch { /* ignore */ }
    setActioning(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="page-content"
      style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}
    >
      <div style={{ maxWidth: "640px" }}>

        {/* ══════════════════════ HEADER ══════════════════════ */}
        <div
          style={{
            paddingBottom: "var(--space-40)",
            borderBottom:  "var(--border-width) solid var(--color-border)",
            marginBottom:  "var(--space-40)",
          }}
        >
          <Link
            href="/"
            style={{
              display:        "inline-block",
              fontSize:       "var(--text-sm)",
              fontWeight:     "var(--font-body)",
              color:          "var(--color-text-secondary)",
              textDecoration: "none",
              marginBottom:   "var(--space-40)",
            }}
          >
            ← Cases
          </Link>

          {/* Sector · Country — no separate page title */}
          <p
            style={{
              fontSize:     "var(--text-lg)",
              fontWeight:   "var(--font-focal)",
              color:        "var(--color-text-primary)",
              marginBottom: "var(--space-8)",
            }}
          >
            {sector} · {country}
          </p>

          <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-tertiary)", marginBottom: "var(--space-8)" }}>
            {c.id}
          </p>
          <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
            {fmtDate(importDate)}
          </p>
        </div>

        {/* ══════════════════════ FINANCIAL SUMMARY ══════════════════════ */}
        <div
          style={{
            paddingBottom: "var(--space-40)",
            borderBottom:  "var(--border-width) solid var(--color-border)",
            marginBottom:  "var(--space-40)",
          }}
        >
          <div
            style={{
              display:             "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap:                 "var(--space-32)",
              marginBottom:        cpr > 0 ? "var(--space-16)" : 0,
            }}
          >
            {/* CBAM charge */}
            <div>
              <SectionLabel>CBAM charge</SectionLabel>
              <p
                style={{
                  marginTop:          "var(--space-8)",
                  fontSize:           "var(--text-lg)",
                  fontWeight:         "var(--font-focal)",
                  color:              "var(--color-navy)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatCurrency(cbamCharge)}
              </p>
            </div>

            {/* Carbon price relief */}
            <div>
              <SectionLabel>Carbon price relief</SectionLabel>
              <p
                style={{
                  marginTop:          "var(--space-8)",
                  fontSize:           "var(--text-lg)",
                  fontWeight:         "var(--font-focal)",
                  color:              cpr > 0 ? "var(--color-green)" : "var(--color-text-tertiary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatCurrency(cpr)}
              </p>
            </div>

            {/* Net liability */}
            <div>
              <SectionLabel>Net liability</SectionLabel>
              <p
                style={{
                  marginTop:          "var(--space-8)",
                  fontSize:           "var(--text-lg)",
                  fontWeight:         "var(--font-focal)",
                  color:              "var(--color-navy)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatCurrency(netLiability)}
              </p>
            </div>
          </div>

          {cpr > 0 && (
            <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", margin: 0 }}>
              Carbon price relief applied — verified by GACI-accredited verifier
            </p>
          )}
        </div>

        {/* ══════════════════════ GOODS LINES ══════════════════════ */}
        <div
          style={{
            paddingBottom: "var(--space-40)",
            borderBottom:  "var(--border-width) solid var(--color-border)",
            marginBottom:  "var(--space-40)",
          }}
        >
          <div style={{ marginBottom: "var(--space-16)" }}>
            <SectionLabel>Goods lines</SectionLabel>
          </div>

          {(c.goods_lines ?? []).length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
              No goods lines extracted yet.
            </p>
          ) : (
            (c.goods_lines ?? []).map((line: CBAMGoodsLine, i: number) => {
              const see     = ROUGH_SEE[line.sector] ?? 1.5;
              const kgco2e  = (line.net_mass_kg / 1000) * see * 1000;
              // Draft cases always use default SEE — no verified emissions yet
              const isDefault = true;

              return (
                <div key={line.id}>
                  {i > 0 && (
                    <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", margin: "var(--space-16) 0" }} />
                  )}

                  {/* CN code · description · method badge · tCO₂e */}
                  <div
                    style={{
                      display:     "flex",
                      alignItems:  "baseline",
                      gap:         "var(--space-16)",
                      flexWrap:    "wrap",
                    }}
                  >
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", ...MONO, whiteSpace: "nowrap" }}>
                      {line.cn_code}
                    </span>

                    <span
                      style={{
                        flex:       1,
                        minWidth:   0,
                        fontSize:   "var(--text-base)",
                        fontWeight: "var(--font-body)",
                        color:      "var(--color-text-primary)",
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

                  {isDefault && (
                    <p
                      style={{
                        fontSize:   "var(--text-sm)",
                        fontWeight: "var(--font-body)",
                        color:      "var(--color-text-secondary)",
                        marginTop:  "var(--space-8)",
                      }}
                    >
                      Using default value of {see.toFixed(2)} tCO₂e/t. Supplier data would reduce this.
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ══════════════════════ AUDIT TRAIL ══════════════════════ */}
        <div
          style={{
            paddingBottom: "var(--space-40)",
            borderBottom:  "var(--border-width) solid var(--color-border)",
            marginBottom:  "var(--space-40)",
          }}
        >
          <div style={{ marginBottom: "var(--space-16)" }}>
            <SectionLabel>Audit trail</SectionLabel>
          </div>

          {!chainValid && (
            <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-red)", marginBottom: "var(--space-16)" }}>
              Chain integrity check failed — this case requires manual verification
            </p>
          )}

          {auditEvents.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
              No audit events yet.
            </p>
          ) : (
            auditEvents.map((ev: AuditEvent) => (
              <div
                key={ev.id}
                style={{
                  display:             "grid",
                  gridTemplateColumns: "180px 1fr auto",
                  alignItems:          "center",
                  gap:                 "var(--space-24)",
                  padding:             "var(--space-8) 0",
                  borderBottom:        "var(--border-width) solid var(--color-border)",
                }}
              >
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                  {fmtTime(ev.created_at)}
                </span>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  {ev.event_type.replace(/_/g, " ")}
                </span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", ...MONO }}>
                  {ev.hmac_sha256?.slice(0, 12) ?? "—"}
                </span>
              </div>
            ))
          )}
        </div>

        {/* ══════════════════════ ACTIONS ══════════════════════ */}
        <div>

          {/* Approved confirmation — replaces buttons inline */}
          {actionDone === "approved" && (
            <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-primary)" }}>
              Case approved.{" "}
              <Link href="/" style={{ color: "var(--color-navy)" }}>
                ← Cases
              </Link>
            </p>
          )}

          {/* Flagged confirmation — replaces buttons inline */}
          {actionDone === "flagged" && (
            <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
              Flag submitted.{" "}
              <Link href="/" style={{ color: "var(--color-text-secondary)" }}>
                ← Cases
              </Link>
            </p>
          )}

          {/* Viewer — no buttons, one line only */}
          {!actionDone && !isAdmin && (
            <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
              You have view-only access. Contact your admin to approve cases.
            </p>
          )}

          {/* Admin + pending review — approve or flag */}
          {!actionDone && isAdmin && isPending && (
            <div>
              <div style={{ display: "flex", gap: "var(--space-16)", flexWrap: "wrap" }}>
                <Button
                  variant="primary"
                  loading={actioning && !showFlagForm}
                  onClick={handleApprove}
                >
                  Approve case
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowFlagForm((v) => !v)}
                >
                  Flag for review
                </Button>
              </div>

              {showFlagForm && (
                <div style={{ marginTop: "var(--space-24)" }}>
                  <textarea
                    rows={3}
                    value={flagText}
                    onChange={(e) => setFlagText(e.target.value)}
                    placeholder="Describe the issue…"
                    style={{
                      width:           "100%",
                      padding:         "var(--space-16)",
                      fontSize:        "var(--text-base)",
                      fontWeight:      "var(--font-body)",
                      fontFamily:      "inherit",
                      color:           "var(--color-text-primary)",
                      backgroundColor: "var(--color-surface)",
                      border:          "var(--border-width) solid var(--color-border)",
                      borderRadius:    "var(--btn-radius)",
                      resize:          "vertical",
                      outline:         "none",
                      boxSizing:       "border-box",
                    }}
                  />
                  <div style={{ marginTop: "var(--space-8)" }}>
                    <Button
                      variant="secondary"
                      loading={actioning && showFlagForm}
                      onClick={handleSendFlag}
                    >
                      Send flag
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Admin + approved — download actions */}
          {!actionDone && isAdmin && isApproved && (
            <div>
              <Button
                variant="secondary"
                onClick={() => { window.location.href = `/api-proxy/ledger/api/cases/${id}/hmrc-return`; }}
              >
                Download HMRC return (PDF)
              </Button>
              <p style={{ marginTop: "var(--space-16)" }}>
                <a
                  href={`/api-proxy/ledger/api/cases/${id}/eu-xml`}
                  style={{
                    fontSize:       "var(--text-sm)",
                    fontWeight:     "var(--font-body)",
                    color:          "var(--color-text-secondary)",
                    textDecoration: "underline",
                  }}
                >
                  Download EU XML declaration
                </a>
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
