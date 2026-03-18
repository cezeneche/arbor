"use client";

// use removed from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getAuditLog } from "@/lib/api";
import { AuditHashChain } from "@/components/audit/AuditHashChain";

interface Props { params: { id: string } }

export default function CaseAuditPage({ params }: Props) {
  const { id } = params;

  const { data: events, isLoading, error } = useQuery({
    queryKey: ["audit-log", id],
    queryFn: () => getAuditLog(id),
  });

  return (
    <div style={{ maxWidth: "720px", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <Link href={`/cases/${id}`} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textDecoration: "none" }}>
        ← Back to case
      </Link>

      <div>
        <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
          Audit Chain
        </h1>
        <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          HMAC-signed event ledger for case <span style={{ fontFamily: "var(--font-mono)" }}>{id}</span>
        </p>
      </div>

      {error && (
        <div role="alert" style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)", backgroundColor: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", color: "var(--color-error-text)", fontSize: "var(--text-sm)" }}>
          Failed to load audit log — {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="skeleton-shimmer" style={{ height: "80px", borderRadius: "var(--radius-lg)" }} />
          ))}
        </div>
      ) : (
        <AuditHashChain events={events ?? []} />
      )}
    </div>
  );
}
