"use client";

import Link from "next/link";
import { useCases } from "@/lib/hooks/useCases";
import { Badge } from "@/components/ui/badge";
import { toStatusVariant, statusLabel, periodLabel } from "@/lib/design-system";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function AuditPage() {
  const { cases, isLoading, error } = useCases();

  return (
    <div className="page-content">
      <div style={{ marginBottom: "var(--space-32)" }}>
        <h1
          style={{
            fontSize:   "var(--text-lg)",
            fontWeight: "var(--font-focal)",
            color:      "var(--color-text-primary)",
          }}
        >
          Audit trails
        </h1>
        <p
          style={{
            fontSize:  "var(--text-sm)",
            color:     "var(--color-text-secondary)",
            marginTop: "var(--space-8)",
          }}
        >
          Each case maintains a tamper-evident HMAC-chained audit log. Select a case to review its chain.
        </p>
      </div>

      {isLoading && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          Loading cases…
        </p>
      )}

      {error && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>
          {error.message}
        </p>
      )}

      {!isLoading && !error && cases.length === 0 && (
        <div
          style={{
            paddingTop:    "var(--space-80)",
            paddingBottom: "var(--space-80)",
            textAlign:     "center",
          }}
        >
          <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>
            No cases yet.
          </p>
        </div>
      )}

      {!isLoading && cases.length > 0 && (
        <div
          style={{
            border:          "var(--border-width) solid var(--color-border)",
            borderRadius:    "var(--card-radius)",
            overflow:        "hidden",
            backgroundColor: "var(--color-surface)",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display:             "grid",
              gridTemplateColumns: "1fr 120px 100px 120px",
              gap:                 "var(--space-16)",
              padding:             "var(--space-16) var(--space-24)",
              borderBottom:        "var(--border-width) solid var(--color-border)",
              backgroundColor:     "var(--color-bg)",
            }}
          >
            {["Importer", "Period", "Status", "Updated"].map((col) => (
              <span
                key={col}
                style={{
                  fontSize:      "var(--text-xs)",
                  fontWeight:    "var(--font-focal)",
                  color:         "var(--color-text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {col}
              </span>
            ))}
          </div>

          {cases.map((c, i) => (
            <Link
              key={c.id}
              href={`/cases/${c.id}/audit`}
              style={{
                display:             "grid",
                gridTemplateColumns: "1fr 120px 100px 120px",
                gap:                 "var(--space-16)",
                padding:             "var(--space-16) var(--space-24)",
                borderTop:           i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
                textDecoration:      "none",
                transition:          "background-color var(--transition-fast)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--color-bg)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent";
              }}
            >
              <div>
                <p
                  style={{
                    fontSize:   "var(--text-base)",
                    fontWeight: "var(--font-body)",
                    color:      "var(--color-text-primary)",
                  }}
                >
                  {c.importer_name}
                </p>
                <p
                  style={{
                    fontSize:  "var(--text-xs)",
                    color:     "var(--color-text-tertiary)",
                    marginTop: "var(--space-8)",
                  }}
                >
                  {c.importer_eori}
                </p>
              </div>

              <span
                style={{
                  fontSize:  "var(--text-sm)",
                  color:     "var(--color-text-secondary)",
                  alignSelf: "center",
                }}
              >
                {periodLabel(c.reporting_year, c.reporting_quarter)}
              </span>

              <div style={{ alignSelf: "center" }}>
                <Badge variant={toStatusVariant(c.status)}>
                  {statusLabel(c.status)}
                </Badge>
              </div>

              <span
                style={{
                  fontSize:  "var(--text-xs)",
                  color:     "var(--color-text-tertiary)",
                  alignSelf: "center",
                }}
              >
                {formatDate(c.updated_at)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
