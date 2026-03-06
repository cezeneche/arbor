"use client";

import { useQuery } from "@tanstack/react-query";
import { listCbamCases } from "@/lib/api";
import { CaseStatusBadge } from "@/components/cases/CaseStatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { CBAMCase } from "@/lib/types";

export default function CasesPage() {
  const [search, setSearch] = useState("");

  const { data: cases, isLoading } = useQuery<CBAMCase[]>({
    queryKey: ["cbam-cases"],
    queryFn: listCbamCases,
  });

  const filtered = cases?.filter((c) =>
    c.importer_eori.toLowerCase().includes(search.toLowerCase()) ||
    (c.importer_name ?? "").toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Cases</h1>
          <p className="text-slate-400 text-sm mt-1">{cases?.length ?? 0} total CBAM cases</p>
        </div>
        <Link href="/cases/new">
          <Button className="bg-teal-600 hover:bg-teal-500 text-white gap-2">
            <Plus className="w-4 h-4" />
            New Case
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by EORI or name…"
          className="pl-9 bg-slate-900 border-slate-800 text-white placeholder:text-slate-500"
        />
      </div>

      {/* Table */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              {["Importer EORI", "Name", "Quarter", "Status", "Review", "Created", ""].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {isLoading ? (
              Array(6).fill(0).map((_, i) => (
                <tr key={i}>
                  {Array(7).fill(0).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full bg-slate-800" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  {search ? "No cases match your search." : "No cases yet."}
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-teal-300 text-xs">{c.importer_eori}</td>
                  <td className="px-4 py-3 text-slate-300">{c.importer_name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-400">Q{c.reporting_quarter} {c.reporting_year}</td>
                  <td className="px-4 py-3"><CaseStatusBadge status={c.status} /></td>
                  <td className="px-4 py-3"><CaseStatusBadge status={c.review_status} /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/cases/${c.id}`}>
                      <Button size="sm" variant="ghost" className="text-teal-400 hover:text-teal-300 hover:bg-teal-500/10">
                        View →
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
