/**
 * lib/api/documents.ts — Document upload API
 *
 * Backend route (proxied through /api-proxy/ledger):
 *   POST /api/cbam/drafts/from-document   — multipart upload, extract + create draft
 *   POST /api/cbam/cases/{case_id}/documents — additional document upload
 *
 * Note: upload uses xhrUpload (not fetch) so the useUpload hook can
 * report byte-level progress.
 */

import { xhrUpload, LEDGER_BASE } from "./client";
import type { DraftResult } from "./types";

/* ── Primary upload: file → extraction → CBAM draft (single round-trip) ──────── *
 * Sends the file as multipart/form-data.                                        *
 * The backend extracts data, arbitrates, repairs, creates the CBAM case +      *
 * shipment + goods lines, and returns the full draft result.                   *
 * onProgress receives 0–100 as the upload bytes transfer; server processing    *
 * continues after 100 while the Promise is still pending.                      */

export function createDraftFromDocument(
  file:       File,
  onProgress: (pct: number) => void = () => {}
): Promise<DraftResult> {
  const form = new FormData();
  form.append("file", file);

  return xhrUpload<DraftResult>(
    `${LEDGER_BASE}/api/cbam/drafts/from-document`,
    form,
    onProgress
  );
}
