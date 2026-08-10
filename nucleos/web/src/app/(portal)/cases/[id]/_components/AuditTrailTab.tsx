"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditLog, type AuditLogResult } from "@/lib/api/audit";
import { MONO, fmtTime, actorLabel } from "./shared";
import type { AuditEvent } from "@/lib/types";

const AUDIT_EVENT_LABELS: Record<string, string> = {
  case_created:                  "Case created",
  case_fields_updated:           "Fields updated",
  document_uploaded:             "Document uploaded",
  extraction_complete:           "Extraction complete",
  cbam_calculation_completed:    "Calculation completed",
  human_review_required:         "Human review required",
  review_approved:               "Case approved",
  review_rejected:               "Case flagged",
  report_package_generated:      "Report package generated",
  supplier_emissions_submitted:  "Supplier data received",
};

function eventLabel(type: string): string {
  return AUDIT_EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

function safePayload(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  }
  return null;
}

function eventActor(ev: AuditEvent): string {
  const payload = safePayload(ev.payload);
  if (payload?.actor_name && typeof payload.actor_name === "string") return payload.actor_name;
  return actorLabel(ev);
}

export function AuditTrailTab({ caseId, onNewSupplierEvent }: { caseId: string; onNewSupplierEvent?: () => void }) {
  const { data } = useQuery<AuditLogResult>({
    queryKey:       ["audit-log", caseId],
    queryFn:        () => getAuditLog(caseId),
    staleTime:      0,
    enabled:        Boolean(caseId),
    refetchInterval: 30_000,
  });

  const auditEvents: AuditEvent[] = data?.events ?? [];
  const chainValid = data?.chainValid ?? true;

  // Track supplier submission events seen so far; fire callback for new ones.
  const seenSupplierEventIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    auditEvents
      .filter(ev => ev.event_type === "supplier_emissions_submitted")
      .forEach(ev => {
        if (!seenSupplierEventIds.current.has(ev.id)) {
          seenSupplierEventIds.current.add(ev.id);
          onNewSupplierEvent?.();
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditEvents]);

  const [filterActor, setFilterActor] = useState("");
  const [filterType,  setFilterType]  = useState("");
  const [filterFrom,  setFilterFrom]  = useState("");
  const [filterTo,    setFilterTo]    = useState("");

  const allActors = Array.from(new Set(auditEvents.map(ev => eventActor(ev)).filter(Boolean)));
  const allTypes  = Array.from(new Set(auditEvents.map(ev => ev.event_type)));

  const filtered = auditEvents.filter(ev => {
    if (filterActor && eventActor(ev) !== filterActor) return false;
    if (filterType  && ev.event_type !== filterType)   return false;
    if (filterFrom) {
      const fromTs = new Date(filterFrom).getTime();
      if (new Date(ev.created_at).getTime() < fromTs) return false;
    }
    if (filterTo) {
      const toTs = new Date(filterTo).getTime() + 86_400_000;
      if (new Date(ev.created_at).getTime() > toTs) return false;
    }
    return true;
  });

  const hasFilter = Boolean(filterActor || filterType || filterFrom || filterTo);

  const inputStyle: React.CSSProperties = {
    height: "32px", padding: "0 10px", fontSize: "var(--text-xs)",
    fontFamily: "inherit", color: "var(--color-text-primary)",
    backgroundColor: "var(--color-surface)",
    border: "0.5px solid var(--color-border)", borderRadius: "6px",
    outline: "none", boxSizing: "border-box" as const, appearance: "none" as const,
  };

  return (
    <div>
      {!chainValid && (
        <div style={{ padding: "var(--space-16) var(--space-24)", marginBottom: "var(--space-24)", backgroundColor: "var(--color-red-bg)", border: "var(--border-width) solid var(--color-red)", borderRadius: "6px" }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: 0 }}>
            Chain integrity check failed — this case requires manual verification before submission.
          </p>
        </div>
      )}

      {chainValid && auditEvents.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "var(--space-24)" }}>
          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--color-green)", flexShrink: 0 }} />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            Chain integrity verified — {auditEvents.length} event{auditEvents.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {auditEvents.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-8)", marginBottom: "var(--space-24)", padding: "var(--space-16)", backgroundColor: "var(--color-surface)", border: "var(--border-width) solid var(--color-border)", borderRadius: "8px" }}>
          <select value={filterActor} onChange={e => setFilterActor(e.target.value)} style={inputStyle}>
            <option value="">All actors</option>
            {allActors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={inputStyle}>
            <option value="">All events</option>
            {allTypes.map(t => <option key={t} value={t}>{eventLabel(t)}</option>)}
          </select>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ ...inputStyle, width: "140px" }} />
          <input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   style={{ ...inputStyle, width: "140px" }} />
          {hasFilter && (
            <button
              onClick={() => { setFilterActor(""); setFilterType(""); setFilterFrom(""); setFilterTo(""); }}
              style={{ height: "32px", padding: "0 10px", fontSize: "var(--text-xs)", fontFamily: "inherit", color: "var(--color-text-secondary)", backgroundColor: "transparent", border: "0.5px solid var(--color-border)", borderRadius: "6px", cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {auditEvents.length === 0 && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>No audit events yet.</p>
      )}

      {filtered.length === 0 && auditEvents.length > 0 && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>No events match the current filter.</p>
      )}

      <div style={{ border: filtered.length > 0 ? "var(--border-width) solid var(--color-border)" : "none", borderRadius: "8px", overflow: "hidden" }}>
        {filtered.map((ev, i) => {
          const hmac      = ev.hmac_sha256 ?? ev.signature;
          const actor     = eventActor(ev);
          const isLast    = i === filtered.length - 1;
          const payload   = safePayload(ev.payload);
          const rawChanges = payload?.field_changes;
          const changes   = rawChanges && typeof rawChanges === "object" && !Array.isArray(rawChanges)
            ? rawChanges as Record<string, unknown>
            : null;
          const changeEntries = changes ? Object.entries(changes) : [];

          return (
            <div
              key={ev.id}
              style={{ padding: "var(--space-16) var(--space-24)", borderBottom: isLast ? undefined : "var(--border-width) solid var(--color-border)" }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-16)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "4px" }}>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                      {fmtTime(ev.created_at)}
                    </span>
                    {ev.verified === false && (
                      <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-red)", backgroundColor: "var(--color-red-bg)", padding: "1px 6px", borderRadius: "3px" }}>
                        invalid
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: "0 0 4px" }}>
                    {eventLabel(ev.event_type)}
                  </p>
                  {changeEntries.map(([label, val]) => {
                    const from = typeof val === "object" && val !== null ? String((val as { from?: unknown }).from ?? "") : "";
                    const to   = typeof val === "object" && val !== null ? String((val as { to?: unknown }).to   ?? "") : "";
                    return (
                      <div key={label} style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", marginBottom: "2px" }}>
                        <span style={{ fontWeight: 500 }}>{label}:</span>{" "}
                        {from ? (
                          <><span style={{ textDecoration: "line-through", color: "var(--color-text-tertiary)" }}>{from}</span>{" → "}{to}</>
                        ) : (
                          <span style={{ color: "var(--color-green)" }}>{to}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                  {actor && actor !== "system" && (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>{actor}</span>
                  )}
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", ...MONO, whiteSpace: "nowrap" }}>{hmac?.slice(0, 12) ?? "—"}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
