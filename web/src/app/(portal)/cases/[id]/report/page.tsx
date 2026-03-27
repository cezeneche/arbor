"use client";

import Link from "next/link";
import { use } from "react";
import { useCase, useReportPackage } from "@/lib/hooks/useCases";
import { Card } from "@/components/ui/card";
import { formatTco2e, periodLabel } from "@/lib/design-system";

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { case_,  isLoading: caseLoading  } = useCase(id);
  const { report, isLoading: reportLoading } = useReportPackage(id);

  const isLoading = caseLoading || reportLoading;

  if (isLoading) {
    return (
      <div className="page-content">
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Loading…</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="page-content">
        <Link
          href={`/cases/${id}`}
          style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "inline-block", marginBottom: "var(--space-32)" }}
        >
          ← Back to case
        </Link>
        <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>
          Report not yet available.
        </p>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", marginTop: "var(--space-8)" }}>
          Run the pipeline to generate the compliance report.
        </p>
        <Link
          href={`/cases/${id}/pipeline`}
          style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", display: "inline-block", marginTop: "var(--space-24)" }}
        >
          Go to pipeline →
        </Link>
      </div>
    );
  }

  const totalTco2e = report.total_kgco2e / 1000;

  return (
    <div className="page-content">
      <Link
        href={`/cases/${id}`}
        style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "inline-block", marginBottom: "var(--space-32)" }}
      >
        ← Back to case
      </Link>

      {/* Hero — liability number. One per screen. */}
      <div style={{ marginBottom: "var(--space-48)" }}>
        <p
          style={{
            fontSize:  "var(--text-sm)",
            color:     "var(--color-text-secondary)",
            marginBottom: "var(--space-8)",
          }}
        >
          Total embedded emissions —{" "}
          {case_ && periodLabel(report.reporting_year, report.reporting_quarter)}
        </p>
        <p
          style={{
            fontSize:      "var(--text-hero)",
            fontWeight:    "var(--font-focal)",
            color:         "var(--color-navy)",
            letterSpacing: "var(--tracking-hero)",
            lineHeight:    "var(--leading-display)",
          }}
        >
          {totalTco2e.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          <span
            style={{
              fontSize:   "var(--text-lg)",
              fontWeight: "var(--font-body)",
              color:      "var(--color-text-secondary)",
              marginLeft: "var(--space-16)",
            }}
          >
            tCO₂e
          </span>
        </p>
      </div>

      <div className="divider" style={{ marginBottom: "var(--space-32)" }} />

      {/* Emissions breakdown */}
      <Card style={{ marginBottom: "var(--space-32)" }}>
        <h2
          style={{
            fontSize:     "var(--text-sm)",
            fontWeight:   "var(--font-focal)",
            color:        "var(--color-text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            marginBottom: "var(--space-24)",
          }}
        >
          Emissions breakdown
        </h2>

        <div
          style={{
            display:             "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap:                 "var(--space-32)",
          }}
        >
          {[
            { label: "Total",    value: formatTco2e(report.total_kgco2e) },
            { label: "Direct",   value: formatTco2e(report.total_direct_kgco2e) },
            { label: "Indirect", value: formatTco2e(report.total_indirect_kgco2e) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p
                style={{
                  fontSize:   "var(--text-xs)",
                  color:      "var(--color-text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: "var(--space-8)",
                }}
              >
                {label}
              </p>
              <p
                style={{
                  fontSize:  "var(--text-lg)",
                  fontWeight: "var(--font-body)",
                  color:     "var(--color-text-primary)",
                }}
              >
                {value}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Narrative */}
      {report.narrative && (
        <Card style={{ marginBottom: "var(--space-32)" }}>
          <h2
            style={{
              fontSize:     "var(--text-sm)",
              fontWeight:   "var(--font-focal)",
              color:        "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: "var(--space-24)",
            }}
          >
            Compliance narrative
          </h2>
          <p
            style={{
              fontSize:   "var(--text-base)",
              color:      "var(--color-text-primary)",
              lineHeight: "var(--leading-body)",
              whiteSpace: "pre-wrap",
            }}
          >
            {report.narrative}
          </p>
        </Card>
      )}

      {/* Downloads */}
      <div style={{ display: "flex", gap: "var(--space-16)" }}>
        <a
          href={`/api-proxy/ledger/api/cbam/cases/${id}/hmrc-return`}
          download
          style={{
            fontSize:   "var(--text-sm)",
            fontWeight: "var(--font-focal)",
            color:      "var(--color-navy)",
            textDecoration: "none",
          }}
        >
          Download HMRC return →
        </a>
        <a
          href={`/api-proxy/ledger/api/cbam/cases/${id}/eu-declaration`}
          download
          style={{
            fontSize:   "var(--text-sm)",
            fontWeight: "var(--font-focal)",
            color:      "var(--color-navy)",
            textDecoration: "none",
          }}
        >
          Download EU declaration →
        </a>
      </div>
    </div>
  );
}
