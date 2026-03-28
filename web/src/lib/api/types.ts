/**
 * lib/api/types.ts — Domain types for the CBAM Portal data layer
 *
 * Canonical source of truth for all request/response shapes.
 * Mirrors the Pydantic models in nucleo-ledger and nucleo-narrative.
 * Existing lib/types.ts types are re-exported here for convenience.
 */

// ── Re-export core types from the root types file ─────────────────────────────
export type {
  CaseStatus,
  ReviewStatus,
  EmissionsMethod,
  CBAMSector,
  CBAMCase,
  CBAMCaseCreate,
  CBAMShipment,
  CBAMGoodsLine,
  CBAMEmission,
  ReportPackage,
  PipelineResult,
  ReviewDecision,
  ReviewSignoff,
  ReviewState,
  AuditEvent,
  TokenResponse,
  AuthContext,
  ApiErrorBody,
} from "@/lib/types";

// ── User (decoded from JWT) ────────────────────────────────────────────────────

export interface User {
  sub:       string;
  tenant_id: string;
  scopes:    string[];
  /** Optional display name encoded in the token. Defaults to sub. */
  name?:     string;
  exp:       number;
}

// ── API Error ─────────────────────────────────────────────────────────────────

export interface ApiErrorShape {
  status:  number;
  message: string;         /* Plain English — safe to display to users */
  code:    string;         /* Machine-readable, e.g. "NOT_FOUND"       */
}

// ── Cases ─────────────────────────────────────────────────────────────────────

/** Summary row returned from GET /api/cbam/cases */
export interface Case {
  id:                 string;
  importer_name:      string;
  importer_eori:      string;
  reporting_year:     number;
  reporting_quarter:  1 | 2 | 3 | 4;
  status:             import("@/lib/types").CaseStatus;
  review_status:      import("@/lib/types").ReviewStatus;
  tenant_id:          string;
  created_at:         string;
  updated_at:         string;
}

/** Full case including shipments and goods lines */
export interface CaseDetail extends Case {
  shipments: import("@/lib/types").CBAMShipment[];
  goods_lines: import("@/lib/types").CBAMGoodsLine[];
}

// ── Documents ─────────────────────────────────────────────────────────────────

/** Response from POST /api/cases/{case_id}/documents/upload */
export interface UploadResponse {
  id:           string;
  document_id:  string;   /* alias — same as id */
  case_id:      string;
  filename:     string;
  storage_uri:  string;
  sha256:       string;
  doc_type:     string;
  uploaded_at:  string;
}

/** Response from POST /api/cases/{case_id}/extract */
export interface ExtractionResult {
  case_id:             string;
  document_id:         string;
  status:              "complete" | "partial" | "failed";
  extracted_fields:    Record<string, unknown>;
  confidence_score?:   number;
  method:              import("@/lib/types").EmissionsMethod;
  extraction_version:  number;
  created_at:          string;
}

/** Response from POST /api/cbam/drafts/from-document */
export interface DraftResult {
  created: {
    case_id:       string;
    shipment_id:   string;
    goods_line_ids: string[];
    emissions_ids: string[];
    warnings:      string[];
  };
  warnings:        string[];
  document_sha256: string;
}

// ── Audit export ──────────────────────────────────────────────────────────────

export interface AuditExport {
  export_uri: string;
  expires_at: string;
}
