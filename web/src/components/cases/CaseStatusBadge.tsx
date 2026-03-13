/**
 * CaseStatusBadge — maps ledger case / review statuses to a StatusDot.
 *
 * Status is communicated via dot colour + text — never colour alone.
 */
import { StatusDot, type StatusValue } from "@/components/ui/StatusDot";
import type { CaseStatus, ReviewStatus } from "@/lib/types";

const STATUS_MAP: Record<string, { statusValue: StatusValue; label: string }> = {
  draft:             { statusValue: "pending",    label: "Draft" },
  submitted:         { statusValue: "processing", label: "Submitted" },
  extracted:         { statusValue: "processing", label: "Extracted" },
  calculated:        { statusValue: "processing", label: "Calculated" },
  resolved:          { statusValue: "processing", label: "Resolved" },
  bundled:           { statusValue: "processing", label: "Bundled" },
  narrative_drafted: { statusValue: "processing", label: "Narrative Ready" },
  signed_off:        { statusValue: "approved",   label: "Signed Off" },
  pending_review:    { statusValue: "pending",    label: "Pending Review" },
  approved:          { statusValue: "approved",   label: "Approved" },
  rejected:          { statusValue: "error",      label: "Rejected" },
  flagged:           { statusValue: "flagged",    label: "Flagged" },
};

interface Props {
  status?: CaseStatus | ReviewStatus | string | null;
}

export function CaseStatusBadge({ status }: Props) {
  if (!status) return null;
  const mapping = STATUS_MAP[status];
  return (
    <StatusDot
      status={mapping?.statusValue ?? "pending"}
      label={mapping?.label ?? status}
      size="sm"
    />
  );
}
