import type { AuditEvent } from "@/lib/types";
import { ShieldCheck } from "lucide-react";

interface Props {
  events: AuditEvent[];
}

export function AuditHashChain({ events }: Props) {
  if (!events.length) {
    return <p className="text-slate-500 text-sm">No audit events yet.</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((event, i) => (
        <div key={event.id} className="flex gap-4 p-4 bg-slate-900 rounded-lg border border-slate-800">
          {/* Chain connector */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-teal-400" />
            </div>
            {i < events.length - 1 && (
              <div className="w-px flex-1 bg-slate-800 min-h-[16px]" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-white">{event.event_type}</span>
              <span
                style={{
                  fontSize: "10px",
                  padding: "1px 6px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--color-surface-raised)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-secondary)",
                  fontWeight: "var(--font-weight-medium)",
                }}
              >
                {event.actor_type}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {event.actor_sub} · {new Date(event.created_at).toLocaleString()}
            </p>
            {/* HMAC hash */}
            <p className="text-[10px] font-mono text-slate-600 mt-1.5 truncate">
              #{event.hmac_sha256.slice(0, 32)}…
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
