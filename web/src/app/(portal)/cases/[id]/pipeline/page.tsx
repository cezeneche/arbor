"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useCase } from "@/lib/hooks/useCases";
import { Badge } from "@/components/ui/badge";
import { narrativeFetch } from "@/lib/api/client";
import type { CaseStatus } from "@/lib/types";

const STAGES: { key: CaseStatus; label: string; description: string }[] = [
  { key: "submitted",         label: "Submitted",         description: "Document uploaded and queued" },
  { key: "extracted",         label: "Extracted",         description: "CBAM data extracted from document" },
  { key: "calculated",        label: "Calculated",        description: "Embedded emissions calculated" },
  { key: "resolved",          label: "Resolved",          description: "Conflicts arbitrated and resolved" },
  { key: "bundled",           label: "Bundled",           description: "Report package assembled" },
  { key: "narrative_drafted", label: "Narrative drafted", description: "Compliance narrative generated" },
  { key: "signed_off",        label: "Signed off",        description: "Case approved and complete" },
];

const STATUS_ORDER: CaseStatus[] = [
  "draft", "submitted", "extracted", "calculated",
  "resolved", "bundled", "narrative_drafted", "signed_off",
];

function stageStatus(stageKey: CaseStatus, currentStatus: CaseStatus): "done" | "current" | "pending" {
  const stageIdx   = STATUS_ORDER.indexOf(stageKey);
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);
  if (stageIdx < currentIdx)  return "done";
  if (stageIdx === currentIdx) return "current";
  return "pending";
}

export default function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { case_, isLoading, error, refetch } = useCase(id);
  const [running,      setRunning]      = useState(false);
  const [runError,     setRunError]     = useState<string | null>(null);
  const [runComplete,  setRunComplete]  = useState(false);
  const [reviewNeeded, setReviewNeeded] = useState(false);

  async function runPipeline() {
    setRunning(true);
    setRunError(null);
    try {
      const result = await narrativeFetch<{ human_review_required: boolean }>(
        `/api/cases/${id}/narrative/pipeline?packet_kind=cbam`,
        { method: "POST" }
      );
      setRunComplete(true);
      setReviewNeeded(result.human_review_required);
      refetch();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Pipeline failed. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  const canRun = !isLoading && !!case_ && ["bundled", "resolved", "calculated", "extracted"].includes(case_.status);

  // Auto-trigger the pipeline — must be before any early returns (Rules of Hooks)
  useEffect(() => {
    if (canRun && !runComplete && !running) {
      runPipeline();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRun]);

  if (isLoading) {
    return (
      <div className="page-content">
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Loading…</p>
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
      <Link
        href={`/cases/${id}`}
        style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "inline-block", marginBottom: "var(--space-32)" }}
      >
        ← Back to case
      </Link>

      <h1
        style={{
          fontSize:     "var(--text-lg)",
          fontWeight:   "var(--font-focal)",
          color:        "var(--color-text-primary)",
          marginBottom: "var(--space-48)",
        }}
      >
        Processing pipeline
      </h1>

      {/* Stage list */}
      <div style={{ marginBottom: "var(--space-48)" }}>
        {STAGES.map((stage, i) => {
          const status = stageStatus(stage.key, case_.status);
          return (
            <div
              key={stage.key}
              style={{
                display:     "flex",
                gap:         "var(--space-24)",
                paddingBottom: i < STAGES.length - 1 ? "var(--space-24)" : 0,
              }}
            >
              {/* Indicator */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  style={{
                    width:           "12px",
                    height:          "12px",
                    borderRadius:    "50%",
                    backgroundColor:
                      status === "done"    ? "var(--color-green)" :
                      status === "current" ? "var(--color-navy)"  : "var(--color-border)",
                    flexShrink: 0,
                    marginTop:  "4px",
                  }}
                />
                {i < STAGES.length - 1 && (
                  <div
                    style={{
                      width:           "1px",
                      flex:            1,
                      minHeight:       "24px",
                      backgroundColor: status === "done" ? "var(--color-green)" : "var(--color-border)",
                      marginTop:       "var(--space-8)",
                    }}
                  />
                )}
              </div>

              {/* Content */}
              <div style={{ paddingBottom: i < STAGES.length - 1 ? "var(--space-8)" : 0 }}>
                <p
                  style={{
                    fontSize:  "var(--text-base)",
                    fontWeight: status === "current" ? "var(--font-focal)" : "var(--font-body)",
                    color:
                      status === "pending" ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
                  }}
                >
                  {stage.label}
                </p>
                <p
                  style={{
                    fontSize:  "var(--text-sm)",
                    color:     "var(--color-text-secondary)",
                    marginTop: "var(--space-8)",
                  }}
                >
                  {stage.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Auto-running — show error inline if pipeline fails */}
      {runError && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", marginBottom: "var(--space-24)" }}>
          {runError}
        </p>
      )}

      {/* Inline confirmation */}
      {runComplete && (
        <div
          style={{
            padding:         "var(--space-24)",
            border:          "var(--border-width) solid var(--color-border)",
            borderRadius:    "var(--card-radius)",
            backgroundColor: "var(--color-surface)",
          }}
        >
          {reviewNeeded ? (
            <>
              <Badge variant="pending">Human review required</Badge>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-16)" }}>
                The pipeline flagged this case for review before the report can be finalised.
              </p>
              <Link
                href={`/review/${id}`}
                style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", display: "inline-block", marginTop: "var(--space-16)" }}
              >
                Go to review →
              </Link>
            </>
          ) : (
            <>
              <Badge variant="approved">Pipeline complete</Badge>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-16)" }}>
                Narrative generated. The report is ready.
              </p>
              <Link
                href={`/cases/${id}/report`}
                style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", display: "inline-block", marginTop: "var(--space-16)" }}
              >
                View report →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
