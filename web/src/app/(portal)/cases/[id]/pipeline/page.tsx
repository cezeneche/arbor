"use client";

import { use, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { runPipeline, getCbamCase } from "@/lib/api";
import { PipelineSteps, derivePipelineSteps } from "@/components/pipeline/PipelineSteps";
import type { PipelineResult } from "@/lib/types";

interface Props { params: Promise<{ id: string }> }

export default function PipelinePage({ params }: Props) {
  const { id } = use(params);
  const [result, setResult] = useState<PipelineResult | null>(null);

  useQuery({ queryKey: ["cbam-case", id], queryFn: () => getCbamCase(id) });

  const { mutate, isPending } = useMutation({
    mutationFn: () => runPipeline(id),
    onSuccess: (data) => setResult(data),
  });

  const steps = derivePipelineSteps(result, isPending);

  return (
    <div style={{ maxWidth: "900px", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <Link href={`/cases/${id}`} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textDecoration: "none" }}>
        ← Back to case
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-4)" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-primary)" }}>
            Narrative Pipeline
          </h1>
          <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
            {id}
          </p>
        </div>
        <button
          type="button"
          onClick={() => mutate()}
          disabled={isPending}
          style={{
            height: "var(--touch-min)",
            padding: "0 var(--space-5)",
            borderRadius: "var(--radius-btn)",
            border: "none",
            backgroundColor: isPending ? "var(--color-border)" : "var(--color-accent)",
            color: isPending ? "var(--color-text-muted)" : "var(--color-text-on-accent)",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--font-weight-semibold)",
            cursor: isPending ? "not-allowed" : "pointer",
          }}
        >
          {isPending ? "Running…" : "▶ Run Pipeline"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "var(--space-6)", alignItems: "start" }}>
        {/* Pipeline steps */}
        <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-xl)", padding: "var(--space-5)" }}>
          <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-xs)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-wide)" }}>
            Pipeline stages
          </p>
          <PipelineSteps steps={steps} />
        </div>

        {/* Result area */}
        <div>
          {!result && !isPending && (
            <div style={{ backgroundColor: "var(--color-surface)", border: "1px dashed var(--color-border)", borderRadius: "var(--radius-xl)", padding: "var(--space-12)", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
                Click Run Pipeline to generate the compliance narrative.
              </p>
            </div>
          )}

          {result && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              {/* Status banner */}
              {result.human_review_required ? (
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-4)", backgroundColor: "var(--alert-warning-bg)", border: "1px solid var(--alert-warning-border)", borderRadius: "var(--radius-lg)" }}>
                  <span style={{ fontSize: "18px" }} aria-hidden="true">⚠</span>
                  <div>
                    <p style={{ margin: "0 0 2px", fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--alert-warning-text)" }}>Human review required</p>
                    <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>Gemini flagged this narrative. A reviewer must approve before bundling.</p>
                  </div>
                </div>
              ) : result.final_narrative_md ? (
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-4)", backgroundColor: "var(--color-approved-bg)", border: "1px solid var(--color-approved-border)", borderRadius: "var(--radius-lg)" }}>
                  <span style={{ fontSize: "18px" }} aria-hidden="true">✓</span>
                  <p style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-approved-text)" }}>Pipeline complete — narrative approved</p>
                </div>
              ) : null}

              {/* Narrative */}
              {result.final_narrative_md && (
                <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-xl)", padding: "var(--space-6)" }}>
                  <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-xs)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-wide)" }}>
                    Final narrative
                  </p>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: "var(--leading-relaxed)" }}>
                    <ReactMarkdown>{result.final_narrative_md}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
