import type {
  CBAMCase,
  CBAMCaseCreate,
  PipelineResult,
  ReportPackage,
  ReviewDecision,
  ReviewState,
  AuditEvent,
  TokenResponse,
  ApiErrorBody,
} from "./types";

// Proxied through Next.js rewrites → no CORS issues
const LEDGER = "/api-proxy/ledger";
const NARRATIVE = "/api-proxy/narrative";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody
  ) {
    const msg =
      typeof body.detail === "string"
        ? body.detail
        : body.detail?.message ?? body.message ?? `HTTP ${status}`;
    super(msg);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("cbam_token");
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body);
  }
  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────

export function login(
  sub: string,
  tenant_id: string,
  scopes: string[]
): Promise<TokenResponse> {
  return apiFetch(`${LEDGER}/auth/token`, {
    method: "POST",
    body: JSON.stringify({ sub, tenant_id, scopes }),
  });
}

// ── CBAM Cases ────────────────────────────────────────────────────────────

export async function listCbamCases(): Promise<CBAMCase[]> {
  const res = await apiFetch<{ items: CBAMCase[] } | CBAMCase[]>(`${LEDGER}/cbam/cases`);
  // API returns paginated { items, count, offset, limit } or plain array
  return Array.isArray(res) ? res : (res as { items: CBAMCase[] }).items ?? [];
}

export function getCbamCase(id: string): Promise<CBAMCase> {
  return apiFetch(`${LEDGER}/cbam/cases/${id}`);
}

export function createCbamCase(data: CBAMCaseCreate): Promise<CBAMCase> {
  return apiFetch(`${LEDGER}/cbam/cases`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getCbamSummary(id: string): Promise<ReportPackage> {
  return apiFetch(`${LEDGER}/cbam/cases/${id}/summary`);
}

export function getReportPackage(id: string): Promise<ReportPackage> {
  return apiFetch(`${LEDGER}/cbam/cases/${id}/report-package`);
}

// ── Narrative Pipeline ────────────────────────────────────────────────────

export function runPipeline(caseId: string): Promise<PipelineResult> {
  return apiFetch(`${NARRATIVE}/cases/${caseId}/narrative/pipeline`, {
    method: "POST",
  });
}

// ── Review ────────────────────────────────────────────────────────────────

export function getReview(caseId: string): Promise<ReviewState> {
  return apiFetch(`${LEDGER}/cases/${caseId}/review`);
}

export function approveCase(
  caseId: string,
  body: ReviewDecision
): Promise<{ case_id: string; decision: string; signoff_id: string }> {
  return apiFetch(`${LEDGER}/cases/${caseId}/review/approve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function rejectCase(
  caseId: string,
  body: ReviewDecision
): Promise<{ case_id: string; decision: string; signoff_id: string }> {
  return apiFetch(`${LEDGER}/cases/${caseId}/review/reject`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Audit Log ─────────────────────────────────────────────────────────────

export function getAuditLog(caseId: string): Promise<AuditEvent[]> {
  return apiFetch(`${LEDGER}/cases/${caseId}/audit-log`);
}
