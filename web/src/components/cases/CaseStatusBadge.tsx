import { Badge } from "@/components/ui/badge";
import type { CaseStatus, ReviewStatus } from "@/lib/types";

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  draft:             { label: "Draft",            className: "bg-slate-700 text-slate-300 border-slate-600" },
  submitted:         { label: "Submitted",         className: "bg-blue-500/20 text-blue-400 border-blue-500/20" },
  extracted:         { label: "Extracted",         className: "bg-indigo-500/20 text-indigo-400 border-indigo-500/20" },
  calculated:        { label: "Calculated",        className: "bg-purple-500/20 text-purple-400 border-purple-500/20" },
  resolved:          { label: "Resolved",          className: "bg-violet-500/20 text-violet-400 border-violet-500/20" },
  bundled:           { label: "Bundled",           className: "bg-cyan-500/20 text-cyan-400 border-cyan-500/20" },
  narrative_drafted: { label: "Narrative Ready",   className: "bg-teal-500/20 text-teal-400 border-teal-500/20" },
  signed_off:        { label: "Signed Off",        className: "bg-green-500/20 text-green-400 border-green-500/20" },
  // review statuses
  pending_review:    { label: "Pending Review",    className: "bg-amber-500/20 text-amber-400 border-amber-500/20" },
  approved:          { label: "Approved",          className: "bg-green-500/20 text-green-400 border-green-500/20" },
  rejected:          { label: "Rejected",          className: "bg-red-500/20 text-red-400 border-red-500/20" },
};

interface Props {
  status?: CaseStatus | ReviewStatus | string | null;
}

export function CaseStatusBadge({ status }: Props) {
  if (!status) return null;
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    className: "bg-slate-700 text-slate-300 border-slate-600",
  };
  return (
    <Badge variant="outline" className={`text-xs font-medium ${config.className}`}>
      {config.label}
    </Badge>
  );
}
