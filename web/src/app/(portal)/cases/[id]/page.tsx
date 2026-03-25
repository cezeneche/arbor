"use client";

import Link from "next/link";
import { use } from "react";
import { useCase } from "@/lib/hooks/useCases";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toStatusVariant, statusLabel, periodLabel } from "@/lib/design-system";

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <span
        style={{
          fontSize:      "var(--text-xs)",
          fontWeight:    "var(--font-focal)",
          color:         "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)" }}>
        {value}
      </span>
    </div>
  );
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { case_, isLoading, error } = useCase(id);

  if (isLoading) {
    return (
      <div className="page-content">
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          Loading…
        </p>
      </div>
    );
  }

  if (error || !case_) {
    return (
      <div className="page-content">
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>
          {error?.message ?? "Case not found."}
        </p>
      </div>
    );
  }

  return (
    <div className="page-content">
      {/* Back */}
      <Link
        href="/cases"
        style={{
          fontSize:     "var(--text-sm)",
          color:        "var(--color-text-secondary)",
          display:      "inline-block",
          marginBottom: "var(--space-32)",
        }}
      >
        ← Cases
      </Link>

      {/* Header */}
      <div
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          "var(--space-16)",
          marginBottom: "var(--space-32)",
        }}
      >
        <h1
          style={{
            fontSize:  "var(--text-lg)",
            fontWeight: "var(--font-focal)",
            color:      "var(--color-text-primary)",
          }}
        >
          {case_.importer_name}
        </h1>
        <Badge variant={toStatusVariant(case_.status)}>
          {statusLabel(case_.status)}
        </Badge>
      </div>

      {/* Key facts */}
      <Card style={{ marginBottom: "var(--space-32)" }}>
        <div
          style={{
            display:             "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap:                 "var(--space-32)",
          }}
        >
          <DataRow label="EORI" value={case_.importer_eori} />
          <DataRow
            label="Period"
            value={periodLabel(case_.reporting_year, case_.reporting_quarter)}
          />
          <DataRow
            label="Goods lines"
            value={String(case_.goods_lines?.length ?? 0)}
          />
        </div>
      </Card>

      {/* Navigation */}
      <div
        style={{
          display:      "flex",
          gap:          "var(--space-32)",
          borderBottom: "var(--border-width) solid var(--color-border)",
          paddingBottom: "var(--space-24)",
          marginBottom: "var(--space-32)",
        }}
      >
        {[
          { label: "Pipeline",  href: `/cases/${id}/pipeline` },
          { label: "Report",    href: `/cases/${id}/report`   },
          { label: "Audit",     href: `/cases/${id}/audit`    },
        ].map(({ label, href }) => (
          <Link
            key={label}
            href={href}
            style={{
              fontSize:   "var(--text-sm)",
              fontWeight: "var(--font-focal)",
              color:      "var(--color-navy)",
            }}
          >
            {label} →
          </Link>
        ))}
      </div>

      {/* Goods lines */}
      {case_.goods_lines && case_.goods_lines.length > 0 && (
        <div>
          <h2
            style={{
              fontSize:     "var(--text-sm)",
              fontWeight:   "var(--font-focal)",
              color:        "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: "var(--space-16)",
            }}
          >
            Goods lines
          </h2>

          <div
            style={{
              border:          "var(--border-width) solid var(--color-border)",
              borderRadius:    "var(--card-radius)",
              overflow:        "hidden",
              backgroundColor: "var(--color-surface)",
            }}
          >
            {case_.goods_lines.map((line, i) => (
              <div
                key={line.id}
                style={{
                  display:     "grid",
                  gridTemplateColumns: "120px 1fr 140px",
                  gap:         "var(--space-16)",
                  padding:     "var(--space-16) var(--space-24)",
                  borderTop:   i === 0 ? "none" : "var(--border-width) solid var(--color-border)",
                }}
              >
                <span
                  style={{
                    fontSize:  "var(--text-sm)",
                    color:     "var(--color-text-primary)",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {line.cn_code}
                </span>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  {line.description}
                </span>
                <span
                  style={{
                    fontSize:  "var(--text-xs)",
                    color:     "var(--color-text-tertiary)",
                    textAlign: "right",
                  }}
                >
                  {(line.net_mass_kg / 1000).toLocaleString("en-GB")} t
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
