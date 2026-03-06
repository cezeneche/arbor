"use client";

import { CheckCircle, Circle, Loader2, XCircle } from "lucide-react";

type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

interface Step {
  label: string;
  sublabel: string;
  status: StepStatus;
}

interface Props {
  steps: Step[];
}

const ICON: Record<StepStatus, React.ReactNode> = {
  pending: <Circle className="w-5 h-5 text-slate-600" />,
  running: <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />,
  done:    <CheckCircle className="w-5 h-5 text-green-400" />,
  error:   <XCircle className="w-5 h-5 text-red-400" />,
  skipped: <Circle className="w-5 h-5 text-slate-500" />,
};

export function PipelineSteps({ steps }: Props) {
  return (
    <div className="space-y-1">
      {steps.map((step, i) => (
        <div key={i} className="flex items-start gap-3 py-3">
          <div className="mt-0.5 flex-shrink-0">{ICON[step.status]}</div>
          <div>
            <p className={`text-sm font-medium ${step.status === "done" ? "text-white" : step.status === "running" ? "text-teal-300" : "text-slate-400"}`}>
              {step.label}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">{step.sublabel}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function derivePipelineSteps(result: {
  openai_draft?: string;
  claude_review?: string;
  gemini_gate?: string;
  human_review_required?: boolean;
  error?: string;
} | null, running: boolean) {
  const hasResult = result !== null;

  return [
    {
      label: "OpenAI — Draft narrative",
      sublabel: "Generates initial compliance narrative",
      status: (running ? "running" : hasResult && result?.openai_draft ? "done" : hasResult ? "skipped" : "pending") as StepStatus,
    },
    {
      label: "Claude — Review & improve",
      sublabel: "Checks facts and improves clarity",
      status: (running ? "pending" : hasResult && result?.claude_review ? "done" : hasResult ? "skipped" : "pending") as StepStatus,
    },
    {
      label: "Gemini — Compliance gate",
      sublabel: result?.human_review_required ? "Flagged for human review" : "Approves or flags for review",
      status: (running ? "pending" : hasResult && result?.gemini_gate ? (result.human_review_required ? "error" : "done") : hasResult ? "skipped" : "pending") as StepStatus,
    },
  ];
}
