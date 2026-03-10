"use client";

import { useQuery } from "@tanstack/react-query";
import { listCbamCases } from "@/lib/api";
import { CaseStatusBadge } from "@/components/cases/CaseStatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderOpen, ClipboardCheck, CheckCircle, AlertTriangle } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { CBAMCase } from "@/lib/types";

// Dynamically import recharts to avoid SSR issues
const SectorChart = dynamic(() => import("@/components/SectorChart"), { ssr: false, loading: () => <Skeleton className="h-48 bg-slate-800" /> });

function KpiCard({ title, value, icon: Icon, color }: {
  title: string; value: string | number; icon: React.ElementType; color: string;
}) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{title}</p>
            <p className="text-3xl font-bold text-white mt-1">{value}</p>
          </div>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: cases, isLoading } = useQuery<CBAMCase[]>({
    queryKey: ["cbam-cases"],
    queryFn: listCbamCases,
  });

  const total = cases?.length ?? 0;
  const pending = cases?.filter((c) => c.review_status === "pending_review").length ?? 0;
  const approved = cases?.filter((c) => c.review_status === "approved" || c.status === "signed_off").length ?? 0;
  const recent = cases?.slice(0, 8) ?? [];

  const sectorData = [
    { sector: "Cement",      count: Math.floor(total * 0.3) },
    { sector: "Steel",       count: Math.floor(total * 0.25) },
    { sector: "Aluminium",   count: Math.floor(total * 0.2) },
    { sector: "Fertilisers", count: Math.floor(total * 0.15) },
    { sector: "Hydrogen",    count: Math.floor(total * 0.1) },
  ];

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">CBAM reporting overview</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array(4).fill(0).map((_, i) => (
            <Card key={i} className="bg-slate-900 border-slate-800">
              <CardContent className="pt-5"><Skeleton className="h-12 w-full bg-slate-800" /></CardContent>
            </Card>
          ))
        ) : (
          <>
            <KpiCard title="Total Cases"     value={total}           icon={FolderOpen}     color="bg-teal-500/10 text-teal-400" />
            <KpiCard title="Pending Review"  value={pending}         icon={AlertTriangle}  color="bg-amber-500/10 text-amber-400" />
            <KpiCard title="Approved"        value={approved}        icon={CheckCircle}    color="bg-green-500/10 text-green-400" />
            <KpiCard title="Active"          value={total - approved} icon={ClipboardCheck} color="bg-blue-500/10 text-blue-400" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent cases */}
        <Card className="bg-slate-900 border-slate-800 lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base">Recent Cases</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-10 bg-slate-800" />)}
              </div>
            ) : recent.length === 0 ? (
              <p className="text-slate-500 text-sm py-4 text-center">
                No cases yet.{" "}
                <Link href="/cases/new" className="text-teal-400 hover:underline">Create one</Link>.
              </p>
            ) : (
              <div className="divide-y divide-slate-800">
                {recent.map((c) => (
                  <Link key={c.id} href={`/cases/${c.id}`} className="flex items-center justify-between py-3 hover:bg-slate-800/50 -mx-2 px-2 rounded transition-colors">
                    <div>
                      <p className="text-sm font-medium text-white font-mono">{c.importer_eori}</p>
                      <p className="text-xs text-slate-500">Q{c.reporting_quarter} {c.reporting_year}</p>
                    </div>
                    <CaseStatusBadge status={c.review_status ?? c.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sector chart — client-only */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base">Cases by Sector</CardTitle>
          </CardHeader>
          <CardContent>
            <SectorChart data={sectorData} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
