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
  case_id:      string;
  status:       import("@/lib/types").CaseStatus;
  shipments:    number;
  goods_lines:  number;
  created_at:   string;
}

// ── Insights ─────────────────────────────────────────────────────────────────

/** Response from GET /api/cbam/insights/kpis */
export interface KPIs {
  importer_eori:        string;
  reporting_year:       number;
  total_cases:          number;
  total_kgco2e:         number;
  total_direct_kgco2e:  number;
  total_indirect_kgco2e: number;
  avg_data_quality:     number;
  method_breakdown:     Record<import("@/lib/types").EmissionsMethod, number>;
  top_cn_codes:         { cn_code: string; kgco2e: number }[];
  eu_ets_price_eur?:    number;
  estimated_cbam_cost?: number;
}

/** One supplier row from GET /api/cbam/insights/supplier-comparison */
export interface SupplierRanking {
  supplier_name:        string;
  origin_country:       string;
  cn_code:              string;
  avg_kgco2e_per_unit:  number;
  data_quality:         number;
  method:               import("@/lib/types").EmissionsMethod;
  case_count:           number;
}

/** One country row from GET /api/cbam/insights/country-intensity */
export interface CountryIntensity {
  country_code:         string;
  country_name:         string;
  avg_kgco2e_per_tonne: number;
  case_count:           number;
  total_kgco2e:         number;
  method_mix:           Record<import("@/lib/types").EmissionsMethod, number>;
}

/** One sector row from GET /api/cbam/insights/sector-summary */
export interface SectorSummary {
  sector:               import("@/lib/types").CBAMSector;
  total_kgco2e:         number;
  direct_kgco2e:        number;
  indirect_kgco2e:      number;
  avg_data_quality:     number;
  case_count:           number;
  method_breakdown:     Record<import("@/lib/types").EmissionsMethod, number>;
}

// ── Audit export ──────────────────────────────────────────────────────────────

export interface AuditExport {
  export_uri: string;
  expires_at: string;
}
