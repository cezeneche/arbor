/**
 * lib/api/cases.ts — CBAM cases API
 *
 * Backend routes (proxied through /api-proxy/ledger):
 *   GET  /api/cbam/cases                      → Case[]
 *   GET  /api/cbam/cases/{id}                 → CaseDetail
 *   GET  /api/cbam/cases/{id}/report-package  → ReportPackage
 *   GET  /api/cases/{id}/review               → ReviewState
 *   POST /api/cases/{id}/review/approve
 *   POST /api/cases/{id}/review/reject
 */

import { ledgerFetch } from "./client";
import type { Case, CaseDetail, ReviewDecision, ReviewState } from "./types";
import type { ReportPackage } from "@/lib/types";

/* ── List ─────────────────────────────────────────────────────────────────────── */

export async function getCases(status?: string): Promise<Case[]> {
  const qs  = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await ledgerFetch<Case[] | { items: Case[] }>(
    `/api/cbam/cases${qs}`
  );
  // Backend may return { items, count, offset, limit } or a bare array
  return Array.isArray(res) ? res : (res as { items: Case[] }).items ?? [];
}

/* ── Single case ──────────────────────────────────────────────────────────────── */

export function getCase(caseId: string): Promise<CaseDetail> {
  return ledgerFetch<CaseDetail>(`/api/cbam/cases/${caseId}`);
}

/* ── Report package ───────────────────────────────────────────────────────────── */

export function getReportPackage(caseId: string): Promise<ReportPackage> {
  return ledgerFetch<ReportPackage>(`/api/cbam/cases/${caseId}/report-package`);
}

/* ── Review ───────────────────────────────────────────────────────────────────── */

export function getReviewState(caseId: string): Promise<ReviewState> {
  return ledgerFetch<ReviewState>(`/api/cases/${caseId}/review`);
}

export function approveCase(caseId: string, reviewer: ReviewDecision): Promise<void> {
  return ledgerFetch<void>(`/api/cases/${caseId}/review/approve`, {
    method: "POST",
    body:   JSON.stringify(reviewer),
  });
}

export function rejectCase(caseId: string, reason: ReviewDecision): Promise<void> {
  return ledgerFetch<void>(`/api/cases/${caseId}/review/reject`, {
    method: "POST",
    body:   JSON.stringify(reason),
  });
}
