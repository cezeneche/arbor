"use client";

import Link from "next/link";
import { useCases } from "@/lib/hooks/useCases";
import { Badge } from "@/components/ui/badge";
import { periodLabel } from "@/lib/design-system";

export default function ReviewQueuePage() {
  const { cases, isLoading, error } = useCases("pending_review");

  const pending = cases.filter(
    (c) => c.review_status === "pending_review" || c.status === "narrative_drafted"
  );

  return (
    <div className="page-content">
      <h1
        style={{
          fontSize:     "var(--text-lg)",
          fontWeight:   "var(--font-focal)",
          color:        "var(--color-text-primary)",
          marginBottom: "var(--space-8)",
        }}
      >
        Pending review
      </h1>
      <p
        style={{
          fontSize:     "var(--text-sm)",
          color:        "var(--color-text-secondary)",
          marginBottom: "var(--space-32)",
        }}
      >
        Cases flagged by the pipeline that require human sign-off before the
        compliance pack is finalised.
      </p>

      {isLoading && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Loading…</p>
      )}

      {error && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>{error.message}</p>
      )}

      {!isLoading && !error && pending.length === 0 && (
        <div style={{ paddingTop: "var(--space-64)", textAlign: "center" }}>
          <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>
            No cases pending review.
          </p>
        </div>
      )}

      {pending.length > 0 && (
        <div
          style={{
            border:          "var(--border-width) solid var(--color-border)",
            borderRadius:    "var(--card-radius)",
            overflow:        "hidden",
            backgroundColor: "var(--color-surface)",
          }}
        >
          {pending.map((c, i) => (
            <Link
              key={c.id}
              href={`/review/${c.id}`}
              style={{
                display:     "grid",
                gridTemplateColumns: "1fr 120px 100px",
                gap:         "var(--space-16)",
                padding:     "var(--space-16) var(--space-24)",
                borderTop:   i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
                textDecoration: "none",
                transition:  "background-color var(--transition-fast)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--color-bg)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent";
              }}
            >
              <div>
                <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-primary)" }}>
                  {c.importer_name}
                </p>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: "var(--space-8)" }}>
                  {c.importer_eori}
                </p>
              </div>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", alignSelf: "center" }}>
                {periodLabel(c.reporting_year, c.reporting_quarter)}
              </span>
              <div style={{ alignSelf: "center" }}>
                <Badge variant="pending">Review required</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
