"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditLog, type AuditLogResult } from "@/lib/api/audit";

const MONO: React.CSSProperties = { fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" };

const EVENT_LABELS: Record<string, string> = {
  case_created:               "Case created",
  case_fields_updated:        "Fields updated",
  document_uploaded:          "Document uploaded",
  extraction_complete:        "Extraction complete",
  cbam_calculation_completed: "Calculation completed",
  human_review_required:      "Human review required",
  review_approved:            "Case approved",
  review_rejected:            "Case flagged",
  report_package_generated:   "Report package generated",
};

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

function shortHash(hash: string | undefined) {
  if (!hash) return "—";
  return hash.slice(0, 8) + "…" + hash.slice(-6);
}

function formatTs(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function safePayload(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  }
  return null;
}

export default function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data, isLoading, error } = useQuery<AuditLogResult>({
    queryKey:  ["audit-log", id],
    queryFn:   () => getAuditLog(id),
    staleTime: 30_000,
  });
  const events = data?.events ?? [];
  const chainValid = data?.chainValid ?? true;

  return (
    <div className="page-content">
      <Link
        href={`/cases/${id}`}
        style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "inline-block", marginBottom: "var(--space-32)" }}
      >
        ← Back to case
      </Link>

      <div
        style={{
          display:      "flex",
          alignItems:   "baseline",
          gap:          "var(--space-16)",
          marginBottom: "var(--space-32)",
        }}
      >
        <h1
          style={{
            fontSize:  "var(--text-lg)",
            fontWeight: "var(--font-focal)",
            color:     "var(--color-text-primary)",
          }}
        >
          Audit chain
        </h1>
        {events.length > 0 && (
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
            {events.length} event{events.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {!isLoading && !chainValid && (
        <div style={{ padding: "var(--space-16) var(--space-24)", marginBottom: "var(--space-24)", backgroundColor: "var(--color-red-bg)", border: "var(--border-width) solid var(--color-red)", borderRadius: "6px" }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: 0 }}>
            Chain integrity check failed — this case requires manual verification before submission.
          </p>
        </div>
      )}

      {isLoading && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Loading…</p>
      )}

      {error && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>
          {(error as Error).message}
        </p>
      )}

      {!isLoading && !error && events.length === 0 && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          No audit events recorded yet.
        </p>
      )}

      {events.length > 0 && (
        <div
          style={{
            border:          "var(--border-width) solid var(--color-border)",
            borderRadius:    "var(--card-radius)",
            overflow:        "hidden",
            backgroundColor: "var(--color-surface)",
          }}
        >
          {events.map((event, i) => {
            const hmac    = event.hmac_sha256 ?? event.signature;
            const actor   = event.actor ?? event.actor_sub;
            const payload = safePayload(event.payload);
            const changes = payload?.field_changes as Record<string, { from: string; to: string }> | undefined;

            return (
              <div
                key={event.id}
                style={{
                  padding:   "var(--space-16) var(--space-24)",
                  borderTop: i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-16)" }}>
                  {/* Left: event label + changes */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "4px" }}>
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                        {formatTs(event.created_at)}
                      </span>
                      {event.verified === false && (
                        <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-red)", backgroundColor: "var(--color-red-bg)", padding: "1px 6px", borderRadius: "3px" }}>
                          invalid
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: "0 0 4px" }}>
                      {eventLabel(event.event_type)}
                    </p>
                    {changes && Object.entries(changes).length > 0 && Object.entries(changes).map(([label, val]) => {
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

                  {/* Right: actor + HMAC */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                    {actor && actor !== "system" && (
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>{actor}</span>
                    )}
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", ...MONO }} title={hmac}>
                      {shortHash(hmac)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
