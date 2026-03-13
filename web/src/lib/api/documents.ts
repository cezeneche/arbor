/**
 * lib/api/documents.ts — Document upload and extraction API
 *
 * Backend routes (proxied through /api-proxy/ledger):
 *   POST /api/cases/{case_id}/documents/upload   — multipart upload
 *   POST /api/cases/{case_id}/extract            — trigger extraction (sync)
 *   POST /api/cbam/drafts/from-document          — create case from document
 *
 * Note: upload uses xhrUpload (not fetch) so the useUpload hook can
 * report byte-level progress. Extract and draft creation use regular fetch.
 */

import { ledgerFetch, xhrUpload, LEDGER_BASE } from "./client";
import type { UploadResponse, ExtractionResult, DraftResult } from "./types";

/* ── Upload ───────────────────────────────────────────────────────────────────── *
 * Sends the file as multipart/form-data.                                        *
 * onProgress receives 0–100 as the upload bytes transfer.                       */

export function uploadDocument(
  file:       File,
  caseId:     string,
  onProgress: (pct: number) => void = () => {}
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);

  return xhrUpload<UploadResponse>(
    `${LEDGER_BASE}/api/cases/${encodeURIComponent(caseId)}/documents/upload`,
    form,
    onProgress
  );
}

/* ── Extract ──────────────────────────────────────────────────────────────────── *
 * Triggers synchronous extraction on the backend.                               *
 * The extraction endpoint returns the result directly — no polling required     *
 * on the happy path. useUpload polls this if the backend returns 202 (async).  */

export function extractDocument(
  caseId:     string,
  documentId: string
): Promise<ExtractionResult> {
  return ledgerFetch<ExtractionResult>(
    `/api/cases/${encodeURIComponent(caseId)}/extract`,
    {
      method: "POST",
      body:   JSON.stringify({ document_id: documentId }),
    }
  );
}

/* ── Create draft from document ───────────────────────────────────────────────── *
 * Sends the document_id (and optional case_id if the case already exists)      *
 * to the backend, which runs extraction and creates the CBAM case structure.   */

export function createDraftFromDocument(
  documentId: string,
  caseId?:    string
): Promise<DraftResult> {
  return ledgerFetch<DraftResult>("/api/cbam/drafts/from-document", {
    method: "POST",
    body:   JSON.stringify({
      document_id: documentId,
      ...(caseId ? { case_id: caseId } : {}),
    }),
  });
}
