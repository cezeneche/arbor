"use client";

/**
 * /audit — HMAC-chained audit log viewer
 *
 * Shows: chain status banner, snapshot timeline, source documents,
 * paginated event table, and export-to-S3 action.
 * All data from GET /api/cases/{id}/audit-log.
 */

import { useState, useCallback } from "react";
import { useQuery }              from "@tanstack/react-query";

import { AlertBanner }       from "@/components/ui/AlertBanner";
import { EmptyState }        from "@/components/ui/EmptyState";
import { SkeletonList }      from "@/components/ui/SkeletonRow";
import { useCases }          from "@/lib/hooks/useCases";
import { getAuditLog, exportAuditLog } from "@/lib/api/audit";
import type { AuditEvent }   from "@/lib/types";
import type { AuditExport }  from "@/lib/api/types";

/* ══════════════════════════════════════════════════════════════════════════════
   Constants
══════════════════════════════════════════════════════════════════════════════ */

const PAGE_SIZE = 20;

const EVENT_LABELS: Record<string, string> = {
  case_created:             "Case created",
  document_uploaded:        "Document uploaded",
  extraction_started:       "Extraction started",
  extraction_complete:      "Data extracted",
  extraction_completed:     "Data extracted",
  arbitration_complete:     "Emission method selected",
  arbitration_completed:    "Emission method selected",
  repair_complete:          "Data gaps filled",
  repair_completed:         "Data gaps filled",
  method_selection:         "Emission method selected",
  report_package_created:   "Report package created",
  compliance_pack_created:  "Compliance pack created",
  pipeline_started:         "Narrative pipeline started",
  pipeline_complete:        "Narrative generated",
  pipeline_completed:       "Narrative generated",
  human_review_required:    "Flagged for human review",
  review_approved:          "Case approved",
  review_rejected:          "Case rejected",
  snapshot_created:         "Snapshot recorded",
};

const SNAPSHOT_STEPS = [
  {
    key:  "extraction_complete",
    also: ["extraction_completed"],
    name: "extraction_v1",
    desc: "Raw data extracted from source documents using the LlamaIndex pipeline.",
  },
  {
    key:  "arbitration_complete",
    also: ["arbitration_completed", "method_selection"],
    name: "arbitrated_v1",
    desc: "Conflicting values resolved and the most accurate emission method selected.",
  },
  {
    key:  "repair_complete",
    also: ["repair_completed"],
    name: "repaired_v1",
    desc: "Missing fields filled using EU Annex VI default emission factors.",
  },
  {
    key:  "report_package_created",
    also: [],
    name: "report_package_v1",
    desc: "Final structured CBAM report package assembled and hashed.",
  },
  {
    key:  "compliance_pack_created",
    also: [],
    name: "compliance_pack_v1",
    desc: "Regulatory compliance pack generated, signed, and ready for submission.",
  },
] as const;

/* ══════════════════════════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════════════════════════ */

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day:    "2-digit",
    month:  "short",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

function isChainValid(events: AuditEvent[]): boolean {
  if (events.length === 0) return true;
  const sorted = [...events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  for (let i = 0; i < sorted.length; i++) {
    if (!sorted[i].hmac_sha256) return false;
    if (i > 0 && sorted[i].prev_hmac && sorted[i].prev_hmac !== sorted[i - 1].hmac_sha256) {
      return false;
    }
  }
  return true;
}

function getEventDetail(event: AuditEvent): string {
  const j = event.event_json;
  if (!j) return "";
  if (event.event_type.includes("document")) return String(j.filename ?? j.document_id ?? "");
  if (event.event_type.includes("extraction")) return String(j.method ?? j.confidence_score ?? "");
  if (event.event_type.startsWith("review_")) return String(j.reviewer_name ?? "");
  if (event.event_type === "case_created") return String(j.importer_eori ?? "");
  if (event.event_type.includes("report") || event.event_type.includes("compliance")) {
    return String(j.version ?? "");
  }
  const first = Object.values(j)[0];
  return first !== null && first !== undefined ? String(first).slice(0, 40) : "";
}

function getActorType(event: AuditEvent): "user" | "ai" | "system" {
  if (event.actor_type === "human") return "user";
  const sub = (event.actor_sub ?? "").toLowerCase();
  if (
    sub.includes("llm") ||
    sub.includes("openai") ||
    sub.includes("claude") ||
    sub.includes("gemini") ||
    sub.includes("ai") ||
    sub.includes("narrative")
  ) {
    return "ai";
  }
  return "system";
}

/* Inline actor badge — not using the domain Badge (which is for method/sector/quarter) */
function ActorBadge({ type }: { type: "user" | "ai" | "system" }) {
  const BADGE = {
    user: {
      label: "User",
      bg:    "var(--color-processing-bg)",
      text:  "var(--color-processing-text)",
      border:"var(--color-processing-border)",
    },
    ai: {
      label: "AI",
      bg:    "var(--color-approved-bg)",
      text:  "var(--color-approved-text)",
      border:"var(--color-approved-border)",
    },
    system: {
      label: "System",
      bg:    "var(--color-surface-raised)",
      text:  "var(--color-text-muted)",
      border:"var(--color-border)",
    },
  };
  const s = BADGE[type];
  return (
    <span
      style={{
        display:         "inline-flex",
        alignItems:      "center",
        padding:         "1px 8px",
        borderRadius:    "var(--radius-full)",
        backgroundColor: s.bg,
        border:          `1px solid ${s.border}`,
        color:           s.text,
        fontSize:        "var(--text-xs)",
        fontWeight:      "var(--font-weight-semibold)",
        whiteSpace:      "nowrap" as const,
        fontFamily:      "var(--font-sans)",
      }}
    >
      {s.label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Chain status banner
══════════════════════════════════════════════════════════════════════════════ */

function ChainStatusBanner({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) return null;
  const valid = isChainValid(events);

  if (!valid) {
    return (
      <AlertBanner
        severity="error"
        message="Chain verification failed — a record may have been altered. Contact your administrator."
        ctaLabel="Learn more"
        onCta={() => {}}
      />
    );
  }

  return (
    <div
      role="status"
      aria-label="Audit chain intact"
      style={{
        display:         "flex",
        alignItems:      "center",
        gap:             "var(--space-3)",
        padding:         "var(--space-3) var(--space-5)",
        backgroundColor: "var(--color-approved-bg)",
        borderBottom:    "2px solid var(--color-approved-border)",
        color:           "var(--color-approved-text)",
        fontSize:        "var(--text-sm)",
        fontFamily:      "var(--font-sans)",
        width:           "100%",
        boxSizing:       "border-box" as const,
      }}
    >
      {/* Shield check icon */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2L3 6v6c0 5.5 3.9 10.7 9 12 5.1-1.3 9-6.5 9-12V6l-9-4z"
          stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <polyline points="9 12 11 14 15 10" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ fontWeight: "var(--font-weight-semibold)" }}>Verified:</span>
      <span>Audit chain intact — all {events.length} records verified.</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Snapshot timeline
══════════════════════════════════════════════════════════════════════════════ */

function SnapshotChain({ events }: { events: AuditEvent[] }) {
  const eventTypes = new Set(events.map((e) => e.event_type));

  const steps = SNAPSHOT_STEPS.map((s) => {
    const matchingEvent = events
      .filter((e) => e.event_type === s.key || s.also.includes(e.event_type as never))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    return {
      ...s,
      done:  Boolean(matchingEvent) || eventTypes.has(s.key) || s.also.some((a) => eventTypes.has(a)),
      ts:    matchingEvent?.created_at,
      hmac:  matchingEvent?.hmac_sha256,
    };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const colour = step.done ? "var(--color-accent)" : "var(--color-border)";

        return (
          <div
            key={step.name}
            style={{
              display: "flex",
              gap:     "var(--space-4)",
            }}
          >
            {/* Left: connector line + dot */}
            <div
              style={{
                display:        "flex",
                flexDirection:  "column",
                alignItems:     "center",
                flexShrink:     0,
                width:          "24px",
              }}
            >
              <div
                style={{
                  width:           "20px",
                  height:          "20px",
                  borderRadius:    "var(--radius-full)",
                  border:          `2px solid ${colour}`,
                  backgroundColor: step.done ? colour : "transparent",
                  flexShrink:      0,
                  display:         "flex",
                  alignItems:      "center",
                  justifyContent:  "center",
                }}
                aria-hidden="true"
              >
                {step.done && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <polyline
                      points="2 6 5 9 10 3"
                      stroke="var(--color-text-on-accent)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              {!isLast && (
                <div
                  aria-hidden="true"
                  style={{
                    flex:            1,
                    width:           "2px",
                    backgroundColor: step.done ? "var(--color-accent)" : "var(--color-border)",
                    minHeight:       "40px",
                    marginTop:       "2px",
                  }}
                />
              )}
            </div>

            {/* Right: step content */}
            <div
              style={{
                paddingBottom: isLast ? 0 : "var(--space-6)",
                paddingTop:    "1px",
                flex:          1,
                minWidth:      0,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" as const }}>
                <span
                  style={{
                    fontSize:   "var(--text-sm)",
                    fontWeight: "var(--font-weight-semibold)",
                    color:      step.done ? "var(--color-text-primary)" : "var(--color-text-muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {step.name}
                </span>
                {step.ts && (
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                    {fmtTime(step.ts)}
                  </span>
                )}
                {!step.done && (
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                    Pending
                  </span>
                )}
              </div>
              <p
                style={{
                  margin:     "2px 0 0",
                  fontSize:   "var(--text-xs)",
                  color:      "var(--color-text-secondary)",
                  lineHeight: "var(--leading-relaxed)",
                }}
              >
                {step.desc}
              </p>
              {step.hmac && (
                <span
                  title={step.hmac}
                  style={{
                    display:      "inline-block",
                    marginTop:    "4px",
                    fontSize:     "var(--text-xs)",
                    fontFamily:   "var(--font-mono)",
                    color:        "var(--color-text-muted)",
                    letterSpacing:"var(--tracking-wide)",
                  }}
                >
                  {step.hmac.slice(0, 12)}&hellip;
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Evidence documents
══════════════════════════════════════════════════════════════════════════════ */

function EvidenceDocuments({ events }: { events: AuditEvent[] }) {
  const docs = events
    .filter((e) => e.event_type === "document_uploaded")
    .map((e) => ({
      filename:   String(e.event_json?.filename ?? "Unknown file"),
      sha256:     String(e.event_json?.sha256    ?? e.event_json?.checksum ?? ""),
      uploadedAt: e.created_at,
    }));

  if (docs.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
        No source documents recorded in this audit log.
      </p>
    );
  }

  return (
    <div
      style={{
        borderRadius: "var(--radius-lg)",
        border:       "1px solid var(--color-border)",
        overflow:     "hidden",
      }}
    >
      {docs.map((doc, i) => (
        <div
          key={i}
          style={{
            display:         "grid",
            gridTemplateColumns: "1fr auto auto",
            alignItems:      "center",
            gap:             "var(--space-5)",
            padding:         "var(--space-3) var(--space-5)",
            backgroundColor: "var(--color-surface)",
            borderBottom:    i < docs.length - 1 ? "1px solid var(--color-border)" : "none",
          }}
        >
          {/* Filename */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"
              style={{ flexShrink: 0, color: "var(--color-text-muted)" }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", fontWeight: "var(--font-weight-medium)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
              {doc.filename}
            </span>
          </div>

          {/* Upload date */}
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", whiteSpace: "nowrap" as const }}>
            {fmtDate(doc.uploadedAt)}
          </span>

          {/* Truncated SHA-256 with full hash on hover */}
          {doc.sha256 ? (
            <span
              title={doc.sha256}
              aria-label={`SHA-256: ${doc.sha256}`}
              style={{
                fontSize:     "var(--text-xs)",
                fontFamily:   "var(--font-mono)",
                color:        "var(--color-text-muted)",
                letterSpacing:"var(--tracking-wide)",
                cursor:       "help",
                whiteSpace:   "nowrap" as const,
              }}
            >
              {doc.sha256.slice(0, 12)}&hellip;
            </span>
          ) : (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>—</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Event log table with pagination
══════════════════════════════════════════════════════════════════════════════ */

function EventLog({ events }: { events: AuditEvent[] }) {
  const [page, setPage] = useState(0);

  const sorted = [...events].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const slice      = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const thStyle: React.CSSProperties = {
    padding:       "var(--space-3) var(--space-4)",
    textAlign:     "left" as const,
    fontWeight:    "var(--font-weight-semibold)",
    color:         "var(--color-text-muted)",
    fontSize:      "var(--text-xs)",
    textTransform: "uppercase" as const,
    letterSpacing: "var(--tracking-wide)",
    whiteSpace:    "nowrap" as const,
  };

  const tdStyle: React.CSSProperties = {
    padding:    "var(--space-3) var(--space-4)",
    fontSize:   "var(--text-sm)",
    color:      "var(--color-text-primary)",
    lineHeight: "var(--leading-normal)",
    verticalAlign: "top" as const,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div
        style={{
          overflowX:    "auto" as const,
          borderRadius: "var(--radius-lg)",
          border:       "1px solid var(--color-border)",
        }}
      >
        <table
          style={{ width: "100%", borderCollapse: "collapse" as const, fontFamily: "var(--font-sans)" }}
        >
          <thead>
            <tr style={{ backgroundColor: "var(--color-surface-raised)", borderBottom: "1px solid var(--color-border)" }}>
              <th style={thStyle}>Time</th>
              <th style={thStyle}>Event</th>
              <th style={thStyle}>Actor</th>
              <th style={thStyle}>Details</th>
              <th style={{ ...thStyle, fontFamily: "var(--font-mono)" }}>HMAC</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((event, i) => {
              const actorType = getActorType(event);
              const detail    = getEventDetail(event);
              const isLast    = i === slice.length - 1;

              return (
                <tr
                  key={event.id}
                  style={{
                    borderBottom:    isLast ? "none" : "1px solid var(--color-border)",
                    backgroundColor: "var(--color-surface)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                      "var(--color-surface-raised)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                      "var(--color-surface)";
                  }}
                >
                  <td style={{ ...tdStyle, color: "var(--color-text-muted)", whiteSpace: "nowrap" as const }}>
                    {fmtTime(event.created_at)}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: "var(--font-weight-medium)" }}>
                    {eventLabel(event.event_type)}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      <ActorBadge type={actorType} />
                      {event.actor_sub && (
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                          {event.actor_sub.length > 20
                            ? event.actor_sub.slice(0, 20) + "\u2026"
                            : event.actor_sub}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, color: "var(--color-text-secondary)", fontFamily: detail ? "var(--font-mono)" : undefined }}>
                    {detail || "—"}
                  </td>
                  <td
                    title={event.hmac_sha256}
                    aria-label={event.hmac_sha256 ? `HMAC: ${event.hmac_sha256}` : "No HMAC"}
                    style={{
                      ...tdStyle,
                      fontFamily:    "var(--font-mono)",
                      color:         "var(--color-text-muted)",
                      letterSpacing: "var(--tracking-wide)",
                      fontSize:      "var(--text-xs)",
                      cursor:        event.hmac_sha256 ? "help" : "default",
                    }}
                  >
                    {event.hmac_sha256
                      ? event.hmac_sha256.slice(0, 12) + "\u2026"
                      : <span style={{ color: "var(--color-error)" }}>missing</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            gap:            "var(--space-4)",
          }}
        >
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length} events
          </span>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {(["← Previous", "Next →"] as const).map((label, idx) => {
              const disabled = idx === 0 ? page === 0 : page === totalPages - 1;
              return (
                <button
                  key={label}
                  type="button"
                  disabled={disabled}
                  onClick={() => setPage((p) => idx === 0 ? p - 1 : p + 1)}
                  style={{
                    minHeight:       "var(--touch-min)",
                    padding:         "0 var(--space-4)",
                    borderRadius:    "var(--radius-md)",
                    border:          "1px solid var(--color-border)",
                    backgroundColor: "transparent",
                    color:           disabled ? "var(--color-text-muted)" : "var(--color-text-secondary)",
                    fontSize:        "var(--text-sm)",
                    fontFamily:      "var(--font-sans)",
                    cursor:          disabled ? "not-allowed" : "pointer",
                    opacity:         disabled ? 0.4 : 1,
                    outline:         "none",
                    transition:      "background-color var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    if (!disabled)
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                        "var(--color-surface-raised)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Export section
══════════════════════════════════════════════════════════════════════════════ */

function ExportSection({ caseId }: { caseId: string }) {
  const [state,   setState]   = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result,  setResult]  = useState<AuditExport | null>(null);
  const [errMsg,  setErrMsg]  = useState("");
  const [copied,  setCopied]  = useState(false);

  const handleExport = useCallback(async () => {
    setState("loading");
    setErrMsg("");
    try {
      const res = await exportAuditLog(caseId);
      setResult(res);
      setState("done");
    } catch (err) {
      setErrMsg(
        err instanceof Error
          ? err.message
          : "Export failed. Please try again."
      );
      setState("error");
    }
  }, [caseId]);

  const handleCopy = useCallback(async () => {
    if (!result?.export_uri) return;
    try {
      await navigator.clipboard.writeText(result.export_uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  }, [result]);

  return (
    <div
      style={{
        display:         "flex",
        flexDirection:   "column",
        gap:             "var(--space-4)",
        padding:         "var(--space-5)",
        backgroundColor: "var(--color-surface)",
        borderRadius:    "var(--radius-xl)",
        border:          "1px solid var(--color-border)",
      }}
    >
      <div>
        <h2
          style={{
            margin:     0,
            fontSize:   "var(--text-base)",
            fontWeight: "var(--font-weight-semibold)",
            color:      "var(--color-text-primary)",
          }}
        >
          Export for submission
        </h2>
        <p
          style={{
            margin:     "var(--space-1) 0 0",
            fontSize:   "var(--text-sm)",
            color:      "var(--color-text-secondary)",
            lineHeight: "var(--leading-relaxed)",
            maxWidth:   "560px",
          }}
        >
          Export the full audit log as a signed JSON file. This will be stored with
          tamper-proof Object Lock and cannot be altered after export.
        </p>
      </div>

      {/* Export button */}
      {state !== "done" && (
        <button
          type="button"
          onClick={handleExport}
          disabled={state === "loading"}
          style={{
            display:         "inline-flex",
            alignItems:      "center",
            gap:             "var(--space-2)",
            minHeight:       "var(--touch-large)",
            padding:         "0 var(--space-6)",
            borderRadius:    "var(--radius-lg)",
            border:          "none",
            backgroundColor: state === "loading" ? "var(--color-surface-raised)" : "var(--color-accent)",
            color:           state === "loading" ? "var(--color-text-muted)" : "var(--color-text-on-accent)",
            fontSize:        "var(--text-base)",
            fontWeight:      "var(--font-weight-semibold)",
            fontFamily:      "var(--font-sans)",
            cursor:          state === "loading" ? "wait" : "pointer",
            transition:      "background-color var(--transition-fast)",
            alignSelf:       "flex-start" as const,
            outline:         "none",
          }}
          onMouseEnter={(e) => {
            if (state !== "loading")
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-accent-hover)";
          }}
          onMouseLeave={(e) => {
            if (state !== "loading")
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-accent)";
          }}
        >
          {/* Download icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <polyline points="7 10 12 15 17 10"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="15" x2="12" y2="3"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {state === "loading" ? "Generating export…" : "Export audit log"}
        </button>
      )}

      {/* Error message */}
      {state === "error" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p
            style={{
              margin:     0,
              fontSize:   "var(--text-sm)",
              color:      "var(--alert-error-text)",
              padding:    "var(--space-3) var(--space-4)",
              borderRadius:"var(--radius-md)",
              backgroundColor:"var(--alert-error-bg)",
              border:     "1px solid var(--alert-error-border)",
            }}
          >
            {errMsg}
          </p>
          <button
            type="button"
            onClick={() => setState("idle")}
            style={{
              alignSelf:       "flex-start" as const,
              minHeight:       "var(--touch-min)",
              padding:         "0 var(--space-4)",
              borderRadius:    "var(--radius-md)",
              border:          "1px solid var(--color-border)",
              backgroundColor: "transparent",
              color:           "var(--color-text-secondary)",
              fontSize:        "var(--text-sm)",
              fontFamily:      "var(--font-sans)",
              cursor:          "pointer",
              outline:         "none",
            }}
          >
            Try again
          </button>
        </div>
      )}

      {/* Success — copyable URI */}
      {state === "done" && result && (
        <div
          style={{
            display:         "flex",
            flexDirection:   "column",
            gap:             "var(--space-3)",
            padding:         "var(--space-4)",
            backgroundColor: "var(--color-approved-bg)",
            border:          "1px solid var(--color-approved-border)",
            borderRadius:    "var(--radius-lg)",
          }}
        >
          <p
            style={{
              margin:     0,
              fontSize:   "var(--text-sm)",
              fontWeight: "var(--font-weight-semibold)",
              color:      "var(--color-approved-text)",
            }}
          >
            Export complete — stored with Object Lock
          </p>

          {result.expires_at && (
            <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-approved-text)", opacity: 0.8 }}>
              Link expires {fmtTime(result.expires_at)}
            </p>
          )}

          {/* Copyable URI row */}
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <input
              type="text"
              readOnly
              value={result.export_uri}
              aria-label="Export download link"
              style={{
                flex:            1,
                padding:         "var(--space-2) var(--space-3)",
                borderRadius:    "var(--radius-md)",
                border:          "1px solid var(--color-approved-border)",
                backgroundColor: "var(--color-surface-raised)",
                color:           "var(--color-text-primary)",
                fontFamily:      "var(--font-mono)",
                fontSize:        "var(--text-xs)",
                outline:         "none",
              }}
              onFocus={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy export link to clipboard"
              style={{
                flexShrink:      0,
                minHeight:       "var(--touch-min)",
                padding:         "0 var(--space-4)",
                borderRadius:    "var(--radius-md)",
                border:          "1px solid var(--color-approved-border)",
                backgroundColor: copied ? "var(--color-approved)" : "transparent",
                color:           copied ? "var(--color-text-on-accent)" : "var(--color-approved-text)",
                fontSize:        "var(--text-sm)",
                fontWeight:      "var(--font-weight-semibold)",
                fontFamily:      "var(--font-sans)",
                cursor:          "pointer",
                transition:      "all var(--transition-fast)",
                outline:         "none",
                whiteSpace:      "nowrap" as const,
              }}
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Section wrapper
══════════════════════════════════════════════════════════════════════════════ */

function Section({
  heading,
  children,
}: {
  heading:  string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h2
        style={{
          margin:      0,
          fontSize:    "var(--text-lg)",
          fontWeight:  "var(--font-weight-semibold)",
          color:       "var(--color-text-primary)",
          lineHeight:  "var(--leading-snug)",
        }}
      >
        {heading}
      </h2>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Page
══════════════════════════════════════════════════════════════════════════════ */

export default function AuditPage() {
  const [selectedId, setSelectedId] = useState("");

  const { cases, isLoading: casesLoading } = useCases();

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey:  ["audit-log", selectedId],
    queryFn:   () => getAuditLog(selectedId),
    enabled:   Boolean(selectedId),
    staleTime: 60_000,
    retry:     2,
  });

  const selectedCase = cases.find((c) => c.id === selectedId);

  const selectStyle: React.CSSProperties = {
    display:         "block",
    width:           "100%",
    maxWidth:        "480px",
    padding:         "var(--space-3) var(--space-4)",
    borderRadius:    "var(--radius-md)",
    border:          "1px solid var(--color-border)",
    backgroundColor: "var(--color-surface)",
    color:           selectedId ? "var(--color-text-primary)" : "var(--color-text-muted)",
    fontFamily:      "var(--font-sans)",
    fontSize:        "var(--text-base)",
    outline:         "none",
    cursor:          "pointer",
    appearance:      "none" as const,
    backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none'%3E%3Cpolyline points='6 9 12 15 18 9' stroke='%234d6680' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
    backgroundRepeat:   "no-repeat",
    backgroundPosition: "right 12px center",
    paddingRight:    "36px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>

      {/* ── Page header ───────────────────────────────────────────────────────── */}
      <div>
        <h1
          style={{
            margin:     0,
            fontSize:   "var(--text-2xl)",
            fontWeight: "var(--font-weight-semibold)",
            color:      "var(--color-text-primary)",
            lineHeight: "var(--leading-tight)",
          }}
        >
          Audit log
        </h1>
        <p
          style={{
            margin:     "var(--space-1) 0 0",
            fontSize:   "var(--text-base)",
            color:      "var(--color-text-secondary)",
          }}
        >
          Tamper-evident record of every action and calculation
        </p>
      </div>

      {/* ── Case selector ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <label
          htmlFor="case-select"
          style={{
            fontSize:   "var(--text-sm)",
            fontWeight: "var(--font-weight-semibold)",
            color:      "var(--color-text-secondary)",
          }}
        >
          Select a case to view its audit trail
        </label>

        {casesLoading ? (
          <div
            style={{
              height:          "48px",
              maxWidth:        "480px",
              borderRadius:    "var(--radius-md)",
              backgroundColor: "var(--color-surface-raised)",
              border:          "1px solid var(--color-border)",
            }}
          />
        ) : cases.length === 0 ? (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
            No cases found. Upload a document to create your first case.
          </p>
        ) : (
          <select
            id="case-select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={selectStyle}
            aria-label="Select a CBAM case"
          >
            <option value="" disabled style={{ color: "var(--color-text-muted)" }}>
              Choose a case…
            </option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.importer_name} — Q{c.reporting_quarter} {c.reporting_year} ({c.id.slice(0, 8).toUpperCase()})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Nothing selected yet ──────────────────────────────────────────────── */}
      {!selectedId && !casesLoading && cases.length > 0 && (
        <EmptyState
          title="No case selected"
          message="Select a case above to view its audit trail."
        />
      )}

      {/* ── Content: shown after case selected ───────────────────────────────── */}
      {selectedId && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>

          {eventsLoading ? (
            <SkeletonList count={6} />
          ) : (
            <>
              {/* Chain status banner — full bleed */}
              {events.length > 0 && (
                <div style={{ marginInline: "calc(-1 * var(--space-6))" }}>
                  <ChainStatusBanner events={events} />
                </div>
              )}

              {/* Case context line */}
              {selectedCase && (
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" as const }}>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                    {selectedCase.importer_name}
                  </span>
                  <span style={{ color: "var(--color-border)" }} aria-hidden="true">·</span>
                  <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>
                    {selectedCase.importer_eori}
                  </span>
                  <span style={{ color: "var(--color-border)" }} aria-hidden="true">·</span>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                    Q{selectedCase.reporting_quarter} {selectedCase.reporting_year}
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>
                    {selectedCase.id.slice(0, 8).toUpperCase()}
                  </span>
                </div>
              )}

              {/* Snapshot chain */}
              <Section heading="Calculation snapshots">
                {events.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                    No snapshots recorded yet. Run the pipeline to generate snapshots.
                  </p>
                ) : (
                  <div
                    style={{
                      padding:         "var(--space-5)",
                      backgroundColor: "var(--color-surface)",
                      borderRadius:    "var(--radius-xl)",
                      border:          "1px solid var(--color-border)",
                    }}
                  >
                    <SnapshotChain events={events} />
                  </div>
                )}
              </Section>

              {/* Evidence documents */}
              <Section heading="Source documents">
                <EvidenceDocuments events={events} />
              </Section>

              {/* Event log */}
              <Section heading="Event log">
                {events.length === 0 ? (
                  <EmptyState
                    title="No events recorded"
                    message="Events will appear here as the case is processed."
                  />
                ) : (
                  <EventLog events={events} />
                )}
              </Section>

              {/* Export */}
              <ExportSection caseId={selectedId} />
            </>
          )}
        </div>
      )}

    </div>
  );
}
