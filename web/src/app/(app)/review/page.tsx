"use client";

import { useQuery } from "@tanstack/react-query";
import { listCbamCases } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { CBAMCase } from "@/lib/types";

export default function ReviewQueuePage() {
  const { data: cases, isLoading } = useQuery<CBAMCase[]>({
    queryKey: ["cbam-cases"],
    queryFn: listCbamCases,
  });

  const queue = cases?.filter((c) => c.review_status === "pending_review") ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-6 h-6 text-amber-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Review Queue</h1>
          <p className="text-slate-400 text-sm mt-0.5">{queue.length} case{queue.length !== 1 ? "s" : ""} awaiting decision</p>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              {["Importer EORI", "Company", "Period", "Case ID", ""].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {isLoading ? (
              Array(3).fill(0).map((_, i) => (
                <tr key={i}>{Array(5).fill(0).map((_, j) => (
                  <td key={j} className="px-4 py-3"><Skeleton className="h-4 bg-slate-800" /></td>
                ))}</tr>
              ))
            ) : queue.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                  No cases pending review. ✓
                </td>
              </tr>
            ) : (
              queue.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-amber-300 text-xs">{c.importer_eori}</td>
                  <td className="px-4 py-3 text-slate-300">{c.importer_name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-400">Q{c.reporting_quarter} {c.reporting_year}</td>
                  <td className="px-4 py-3 font-mono text-slate-500 text-xs">{c.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/review/${c.id}`}>
                      <Button size="sm" className="bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30">
                        Review →
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
