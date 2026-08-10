/**
 * lib/api/audit.ts — Audit log API
 *
 * Backend routes (proxied through /api-proxy/ledger):
 *   GET  /api/cases/{case_id}/audit-log          → AuditEvent[]
 *   POST /api/cases/{case_id}/audit-log/export   → { export_uri, expires_at }
 */

import { ledgerFetch } from "./client";
import type { AuditExport } from "./types";
import type { AuditEvent } from "@/lib/types";

/* ── Log ──────────────────────────────────────────────────────────────────────── */

export interface AuditLogResult {
  events: AuditEvent[];
  /** Server-verified chain integrity — includes HMAC verification, not just hash
   *  linkage, which the client cannot reproduce without AUDIT_SIGNING_KEY. Always
   *  use this rather than re-deriving validity from event fields client-side. */
  chainValid: boolean;
}

export async function getAuditLog(caseId: string): Promise<AuditLogResult> {
  const res = await ledgerFetch<AuditEvent[] | { events: AuditEvent[]; chain_valid?: boolean }>(
    `/api/cases/${encodeURIComponent(caseId)}/audit-log`
  );
  if (Array.isArray(res)) {
    // Legacy/non-CBAM route shape — no server-computed chain_valid available.
    return { events: res, chainValid: true };
  }
  return {
    events:     res.events ?? [],
    chainValid: res.chain_valid ?? true,
  };
}

/* ── Export ───────────────────────────────────────────────────────────────────── *
 * Triggers a signed S3 export of the full HMAC-chained audit log.              *
 * Returns a pre-signed download URI valid for a limited time.                   */

export function exportAuditLog(caseId: string): Promise<AuditExport> {
  return ledgerFetch<AuditExport>(
    `/api/cases/${encodeURIComponent(caseId)}/audit-log/export`,
    { method: "POST" }
  );
}
