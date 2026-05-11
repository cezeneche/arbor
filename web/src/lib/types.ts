// TypeScript types mirroring the Pydantic schemas from nucleo-ledger + nucleo-narrative

export type CaseStatus =
  | "draft"
  | "processing"
  | "submitted"
  | "extracted"
  | "calculated"
  | "resolved"
  | "bundled"
  | "narrative_drafted"
  | "signed_off";

export type ReviewStatus = "pending_review" | "approved" | "rejected" | null;

export type EmissionsMethod = "actual" | "default" | "estimated";

export type CBAMSector =
  | "cement"
  | "iron_steel"
  | "aluminium"
  | "fertilisers"
  | "electricity"
  | "hydrogen";

// ── CBAM Case ──────────────────────────────────────────────────────────────

export interface CBAMCase {
  id: string;
  importer_name: string;
  importer_eori: string;
  reporting_year: number;
  reporting_quarter: 1 | 2 | 3 | 4;
  status: CaseStatus;
  review_status: ReviewStatus;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

export interface CBAMCaseCreate {
  importer_eori: string;
  importer_name?: string;
  reporting_year: number;
  reporting_quarter: 1 | 2 | 3 | 4;
}

// ── Shipment ──────────────────────────────────────────────────────────────

export interface CBAMShipment {
  id: string;
  case_id: string;
  import_date: string;
  entry_reference: string;
  incoterm: string;
  origin_country: string;
}

// ── Goods Line ────────────────────────────────────────────────────────────

export interface CBAMGoodsLine {
  id: string;
  shipment_id: string;
  cn_code: string;
  sector: CBAMSector;
  description: string;
  quantity: number;
  quantity_unit: string;
  net_mass_kg: number;
  installation_name?: string;
  installation_id?: string;
}

// ── Emissions ─────────────────────────────────────────────────────────────

export interface CBAMEmission {
  id: string;
  goods_line_id: string;
  method: EmissionsMethod;
  direct_embedded_kgco2e: number;
  indirect_embedded_kgco2e?: number;
  data_quality_score?: number;
  notes?: string;
  version: number;
}

// ── Report Package ────────────────────────────────────────────────────────

export interface ReportPackage {
  case_id: string;
  importer_eori: string;
  reporting_year: number;
  reporting_quarter: number;
  total_direct_kgco2e: number;
  total_indirect_kgco2e: number;
  total_kgco2e: number;
  emissions_by_sector: Record<CBAMSector, number>;
  lines: CBAMGoodsLine[];
  narrative?: string;
  generated_at: string;
}

// ── Narrative Pipeline ────────────────────────────────────────────────────

export interface PipelineResult {
  case_id: string;
  status: "complete" | "pending_review" | "error";
  human_review_required: boolean;
  final_narrative_md?: string;
  openai_draft?: string;
  claude_review?: string;
  gemini_gate?: string;
  error?: string;
}

// ── Review ────────────────────────────────────────────────────────────────

export interface ReviewDecision {
  reviewer_name: string;
  reviewer_email: string;
  comments?: string;
}

export interface ReviewSignoff {
  id: string;
  case_id: string;
  decision: "approved" | "rejected";
  reviewer_name: string;
  reviewer_email: string;
  comments?: string;
  actor_sub?: string;
  created_at: string;
}

export interface ReviewState {
  case_id: string;
  review_status: ReviewStatus;
  case_status: CaseStatus;
  signoffs: ReviewSignoff[];
}

// ── Audit Log ─────────────────────────────────────────────────────────────

export interface AuditEvent {
  id: string;
  case_id: string;
  event_type: string;
  actor_type?: "human" | "system";
  actor_sub?: string;
  /** actor field as returned by the CBAM audit_log endpoint */
  actor?: string;
  event_json?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  hmac_sha256?: string;
  /** signature field as returned by the CBAM audit_log endpoint */
  signature?: string;
  prev_hmac?: string;
  /** chain_hash field as returned by the CBAM audit_log endpoint */
  chain_hash?: string;
  verified?: boolean;
  created_at: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
}

export interface AuthContext {
  sub: string;
  tenant_id: string;
  scopes: string[];
  roles?: string[];
  exp: number;
  jti?: string;
}

// ── API Error ─────────────────────────────────────────────────────────────

export interface ApiErrorBody {
  detail?: string | { message: string; [key: string]: unknown };
  message?: string;
}
