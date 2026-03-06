"use client";

import { useState, use } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { runPipeline, getCbamCase } from "@/lib/api";
import { PipelineSteps, derivePipelineSteps } from "@/components/pipeline/PipelineSteps";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Play, AlertTriangle, CheckCircle } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import type { PipelineResult } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

export default function PipelinePage({ params }: Props) {
  const { id } = use(params);
  const [result, setResult] = useState<PipelineResult | null>(null);

  useQuery({
    queryKey: ["cbam-case", id],
    queryFn: () => getCbamCase(id),
  });

  const { mutate, isPending } = useMutation({
    mutationFn: () => runPipeline(id),
    onSuccess: (data) => setResult(data),
  });

  const steps = derivePipelineSteps(result, isPending);

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href={`/cases/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to case
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Narrative Pipeline</h1>
          <p className="text-slate-400 text-sm mt-1 font-mono">{id}</p>
        </div>
        <Button
          onClick={() => mutate()}
          disabled={isPending}
          className="bg-teal-600 hover:bg-teal-500 text-white gap-2"
        >
          <Play className="w-4 h-4" />
          {isPending ? "Running…" : "Run Pipeline"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Steps */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm">Pipeline stages</CardTitle>
          </CardHeader>
          <CardContent>
            <PipelineSteps steps={steps} />
          </CardContent>
        </Card>

        {/* Result */}
        <div className="md:col-span-2 space-y-4">
          {!result && !isPending && (
            <div className="bg-slate-900 border border-slate-800 border-dashed rounded-xl p-12 text-center">
              <p className="text-slate-500 text-sm">Click Run Pipeline to generate the compliance narrative.</p>
            </div>
          )}

          {result && (
            <>
              {/* Status banner */}
              {result.human_review_required ? (
                <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-300">Human review required</p>
                    <p className="text-xs text-amber-400/70 mt-0.5">Gemini flagged this narrative. A reviewer must approve before bundling.</p>
                  </div>
                  <Badge className="ml-auto bg-amber-500/20 text-amber-400 border-amber-500/30">
                    Pending Review
                  </Badge>
                </div>
              ) : result.final_narrative_md ? (
                <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <p className="text-sm font-medium text-green-300">Pipeline complete — narrative approved</p>
                </div>
              ) : null}

              {/* Narrative */}
              {result.final_narrative_md && (
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-white text-sm">Final narrative</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-invert prose-sm max-w-none text-slate-300">
                      <ReactMarkdown>{result.final_narrative_md}</ReactMarkdown>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
