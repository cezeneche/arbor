"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ledgerFetch } from "@/lib/api/client";
import type { AuditEvent } from "@/lib/types";

function shortHash(hash: string) {
  return hash.slice(0, 8) + "…" + hash.slice(-6);
}

function formatTs(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: events, isLoading, error } = useQuery<AuditEvent[]>({
    queryKey:  ["audit", id],
    queryFn:   () => ledgerFetch<AuditEvent[]>(`/api/cbam/cases/${id}/audit`),
    staleTime: 60_000,
  });

  return (
    <div className="page-content">
      <Link
        href={`/cases/${id}`}
        style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "inline-block", marginBottom: "var(--space-32)" }}
      >
        ← Case
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
        {events && events.length > 0 && (
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
            {events.length} events
          </span>
        )}
      </div>

      {isLoading && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Loading…</p>
      )}

      {error && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>
          {(error as Error).message}
        </p>
      )}

      {events && events.length === 0 && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          No audit events recorded yet.
        </p>
      )}

      {events && events.length > 0 && (
        <div
          style={{
            border:          "var(--border-width) solid var(--color-border)",
            borderRadius:    "var(--card-radius)",
            overflow:        "hidden",
            backgroundColor: "var(--color-surface)",
          }}
        >
          {events.map((event, i) => (
            <div
              key={event.id}
              style={{
                display:   "grid",
                gridTemplateColumns: "1fr 160px 200px",
                gap:       "var(--space-24)",
                padding:   "var(--space-16) var(--space-24)",
                borderTop: i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
              }}
            >
              {/* Event type */}
              <div>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)" }}>
                  {event.event_type.replace(/_/g, " ")}
                </p>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: "var(--space-8)" }}>
                  {event.actor_type === "human" ? event.actor_sub : "System"}
                </p>
              </div>

              {/* HMAC hash */}
              <span
                style={{
                  fontSize:   "var(--text-xs)",
                  color:      "var(--color-text-tertiary)",
                  fontFamily: "ui-monospace, monospace",
                  alignSelf:  "center",
                }}
                title={event.hmac_sha256}
              >
                {shortHash(event.hmac_sha256)}
              </span>

              {/* Timestamp */}
              <span
                style={{
                  fontSize:  "var(--text-xs)",
                  color:     "var(--color-text-tertiary)",
                  alignSelf: "center",
                  textAlign: "right",
                }}
              >
                {formatTs(event.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
