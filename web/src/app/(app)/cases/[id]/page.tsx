"use client";

import { useQuery } from "@tanstack/react-query";
import { getCbamCase } from "@/lib/api";
import { CaseStatusBadge } from "@/components/cases/CaseStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, User, Calendar, Hash } from "lucide-react";
import Link from "next/link";
import { use } from "react";

interface Props {
  params: Promise<{ id: string }>;
}

export default function CaseDetailPage({ params }: Props) {
  const { id } = use(params);

  const { data: cbamCase, isLoading } = useQuery({
    queryKey: ["cbam-case", id],
    queryFn: () => getCbamCase(id),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-4xl">
        <Skeleton className="h-8 w-64 bg-slate-800" />
        <Skeleton className="h-48 w-full bg-slate-800" />
      </div>
    );
  }

  if (!cbamCase) {
    return <p className="text-slate-400">Case not found.</p>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/cases" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to cases
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white font-mono">{cbamCase.importer_eori}</h1>
          {cbamCase.importer_name && (
            <p className="text-slate-400 text-sm mt-0.5">{cbamCase.importer_name}</p>
          )}
        </div>
        <div className="flex gap-2">
          <CaseStatusBadge status={cbamCase.status} />
          {cbamCase.review_status && <CaseStatusBadge status={cbamCase.review_status} />}
        </div>
      </div>

      {/* Meta cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: Calendar, label: "Reporting period", value: `Q${cbamCase.reporting_quarter} ${cbamCase.reporting_year}` },
          { icon: User, label: "Tenant", value: cbamCase.tenant_id },
          { icon: Hash, label: "Case ID", value: cbamCase.id.slice(0, 8) + "…" },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-slate-900 rounded-lg border border-slate-800 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs text-slate-400">{label}</p>
            </div>
            <p className="text-sm font-medium text-white font-mono">{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="pipeline">
        <TabsList className="bg-slate-900 border border-slate-800">
          {[
            { value: "pipeline", label: "Pipeline" },
            { value: "audit",    label: "Audit Log" },
            { value: "report",   label: "Report" },
          ].map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="data-[state=active]:bg-slate-800 data-[state=active]:text-white text-slate-400">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="pipeline" className="mt-4">
          <Link href={`/cases/${id}/pipeline`}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-teal-500/30 transition-colors cursor-pointer">
              <p className="text-sm font-medium text-white">Open Pipeline View →</p>
              <p className="text-xs text-slate-400 mt-1">Run the OpenAI → Claude → Gemini narrative pipeline and view results.</p>
            </div>
          </Link>
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <Link href={`/cases/${id}/audit`}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-teal-500/30 transition-colors cursor-pointer">
              <p className="text-sm font-medium text-white">View Audit Chain →</p>
              <p className="text-xs text-slate-400 mt-1">HMAC-signed event chain for this case.</p>
            </div>
          </Link>
        </TabsContent>
        <TabsContent value="report" className="mt-4">
          <Link href={`/cases/${id}/report`}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-teal-500/30 transition-colors cursor-pointer">
              <p className="text-sm font-medium text-white">Download Report Package →</p>
              <p className="text-xs text-slate-400 mt-1">View and download the final CBAM compliance report.</p>
            </div>
          </Link>
        </TabsContent>
      </Tabs>
    </div>
  );
}
