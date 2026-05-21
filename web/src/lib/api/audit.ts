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

export async function getAuditLog(caseId: string): Promise<AuditEvent[]> {
  const res = await ledgerFetch<AuditEvent[] | { events: AuditEvent[] }>(
    `/api/cases/${encodeURIComponent(caseId)}/audit-log`
  );
  return Array.isArray(res) ? res : (res as { events: AuditEvent[] }).events ?? [];
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
