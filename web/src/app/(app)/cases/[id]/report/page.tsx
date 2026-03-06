"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { getReportPackage } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";

interface Props {
  params: Promise<{ id: string }>;
}

export default function ReportPage({ params }: Props) {
  const { id } = use(params);

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["report-package", id],
    queryFn: () => getReportPackage(id),
  });

  function downloadJson() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cbam-report-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href={`/cases/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to case
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Report Package</h1>
          <p className="text-slate-400 text-sm mt-1 font-mono">{id}</p>
        </div>
        {report && (
          <Button onClick={downloadJson} className="bg-teal-600 hover:bg-teal-500 text-white gap-2">
            <Download className="w-4 h-4" />
            Download JSON
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-24 bg-slate-800" />)}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-red-400 text-sm">{error.message}</p>
          <p className="text-red-400/60 text-xs mt-1">The report package may not be available yet — run the narrative pipeline first.</p>
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {/* Emissions summary */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Direct CO₂e", value: `${(report.total_direct_kgco2e / 1000).toFixed(2)} tCO₂e` },
              { label: "Indirect CO₂e", value: `${(report.total_indirect_kgco2e / 1000).toFixed(2)} tCO₂e` },
              { label: "Total CO₂e", value: `${(report.total_kgco2e / 1000).toFixed(2)} tCO₂e` },
            ].map(({ label, value }) => (
              <Card key={label} className="bg-slate-900 border-slate-800">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="text-xl font-bold text-white mt-0.5">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Raw JSON preview */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm">Raw report package</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs text-slate-300 overflow-auto max-h-96 font-mono bg-slate-950 p-4 rounded-lg border border-slate-800">
                {JSON.stringify(report, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
