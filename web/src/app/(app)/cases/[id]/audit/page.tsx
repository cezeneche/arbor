"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditLog } from "@/lib/api";
import { AuditHashChain } from "@/components/audit/AuditHashChain";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface Props {
  params: Promise<{ id: string }>;
}

export default function AuditPage({ params }: Props) {
  const { id } = use(params);

  const { data: events, isLoading } = useQuery({
    queryKey: ["audit-log", id],
    queryFn: () => getAuditLog(id),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href={`/cases/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to case
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-white">Audit Chain</h1>
        <p className="text-slate-400 text-sm mt-1">HMAC-signed event ledger for case <span className="font-mono">{id}</span></p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 bg-slate-800" />)}
        </div>
      ) : (
        <AuditHashChain events={events ?? []} />
      )}
    </div>
  );
}
