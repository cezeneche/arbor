/**
 * Generated from contract/schemas. Do not edit by hand.
 *
 * Regenerate with:  python contract/generate.py --python <out> --typescript <out>
 * Verify with:      python contract/generate.py --check
 */

/**
 * Which emissions value entered the calculation.
 *
 * THIS IS NOT A TIER. Arbor carries a separate ProvenanceTier saying how much to trust a record's origin. The two axes are orthogonal and neither derives from the other: a mill certificate can legitimately be ACTUAL method and DECLARED provenance, because the figure is a real measurement and the document backing it was never verified. Both travel on every goods line and both display.
 *
 * Do not collapse these into one field. Every attempt to do so loses one of the two questions a reviewer has to answer.
 *
 * Regulation: EU 2023/1773 Art. 4 numbers these as tiers 1/2/3. That numbering travels as regulation_tier on a rejection reason, never as the name of this axis.
 */
export type EmissionsMethod = 'ACTUAL' | 'ESTIMATED' | 'DEFAULT'

/**
 * How much to trust a record's origin. Arbor's axis.
 *
 * Set only by a human action in Arbor's Review screen. Extraction produces drafts; nothing crossing this boundary may assign a provenance tier. Nucleos never writes this field — it is echoed back so a goods line can carry both axes at once.
 *
 * See EmissionsMethod for why these are separate.
 */
export type ProvenanceTier = 'VERIFIED' | 'DECLARED' | 'ESTIMATED'

export type Jurisdiction = 'EU' | 'UK'

/**
 * One page of extracted text. The page map lets a reviewer find a value in the source document without the document itself crossing the boundary.
 */
export interface PageText {
  page_number: number
  text: string
}

/**
 * What the OCR pass knew about its own output. Arbor owns document-to-text from Phase 2, so this is the only signal Nucleos gets about how trustworthy the text is.
 */
export interface OcrQuality {
  /**
   * 0-1 across the document, when the OCR engine reports it.
   */
  mean_confidence?: number | null
  /**
   * True when any part of the source was not read. Never infer this from the reason string: a reason without the flag is metadata, not a truncation.
   */
  truncated: boolean
  truncation_reason?: string | null
  /**
   * Which OCR path produced the text, for attributing a later accuracy regression.
   */
  engine?: string | null
}

/**
 * Character offsets into the submitted text, so a reviewer can highlight the exact source of a value.
 */
export interface TextSpan {
  start: number
  end: number
}

/**
 * Where a value came from, in the source text.
 */
export interface EvidenceAtom {
  field: string
  value?: unknown
  /**
   * Nucleos's own fine-grained extractor tag: rule_regex, claude, customs_parser, mill_cert_parser, arbiter, repair, and so on.
   *
   * Deliberately NOT Arbor's ExtractionMethod enum (DOCUMENT_AI | MANUAL_ENTRY | SYSTEM_INTEGRATION). Arbor's enum records how a record entered the platform; this records which of Nucleos's extractors produced a particular field. Mapping one onto the other loses the distinction that makes a flag actionable.
   */
  source: string
  confidence: number
  snippet?: string | null
  page?: number | null
  span?: TextSpan | null
}

/**
 * Why a higher-priority emissions method was not used. Mandatory audit trail: a declaration has to be able to say why it did not use actual data.
 */
export interface RejectedMethod {
  method: EmissionsMethod
  /**
   * The EU 2023/1773 Art. 4 tier number for this method. A citation, never the axis name.
   */
  regulation_tier?: number | null
  reason: string
  regulation_ref: string
}

/**
 * One step of the calculation's decision trace, carried verbatim so an auditor can reconstruct the reasoning without re-running the engine.
 */
export interface DecisionAtom {
  step: string
  outcome: string
  detail: string
  value?: unknown
  regulation_ref?: string | null
}

/**
 * Stamped into the response itself rather than inherited transitively, so a figure can be reproduced years later from the response alone.
 */
export interface EngineVersions {
  engine_version: string
  annex_vi_factor_version?: string | null
  markup_table_version?: string | null
  regulation_reference?: string | null
}

export interface CalculatedLine {
  line_id: string
  /**
   * The method the engine actually used. Separate from provenance_tier and never derived from it.
   */
  emissions_method: EmissionsMethod
  /**
   * Echoed back from the declaration payload unchanged, so a goods line displays both axes without Arbor re-joining them. Nucleos does not set this.
   */
  provenance_tier: ProvenanceTier
  direct_kgco2e: number
  indirect_kgco2e: number
  see_direct_tco2e_per_t?: number | null
  see_indirect_tco2e_per_t?: number | null
  see_total_tco2e_per_t?: number | null
  embedded_tco2e: number
  /**
   * Default-value mark-up applied. Zero unless the default method was selected for a year with a legislated schedule.
   */
  markup_fraction?: number | null
  annex_vi_factor_used?: boolean
  /**
   * One entry per higher-priority method that was not used, with the reason. Required: a declaration must be able to say why it did not use actual data.
   */
  rejected_methods?: RejectedMethod[]
  /**
   * The full trace, verbatim.
   */
  decision_trace?: DecisionAtom[]
  warnings?: string[]
}

/**
 * Nucleos -> Arbor. The computed declaration.
 *
 * Fails closed: a calculation that could not be completed returns an error rather than a partial figure. Arbor writes the result; Nucleos never writes to Arbor's database.
 */
export interface CalculationResult {
  case_reference: string
  jurisdiction: Jurisdiction
  reporting_year: number
  reporting_quarter?: number | null
  lines: CalculatedLine[]
  total_embedded_tco2e?: number | null
  /**
   * Verbatim, same rule as extraction flags.
   */
  warnings?: string[]
  engine: EngineVersions
}

/**
 * Arbor -> Nucleos. Text and metadata in.
 *
 * No blob reference and no bytes. From Phase 2 Arbor owns document-to-text and the storage bucket leaves Nucleos entirely, so a document identifier here is a handle for correlation and audit, never something Nucleos can dereference.
 */
export interface CbamExtractionRequest {
  /**
   * Arbor's Document id. Correlation only — Nucleos cannot fetch it.
   */
  document_id: string
  /**
   * Arbor's DocumentType. Nucleos routes on it but does not own the vocabulary.
   */
  document_type: string
  /**
   * Arbor's Entity id. Scopes the request; Nucleos does not resolve it to a tenant of its own.
   */
  entity_id: string
  /**
   * Full extracted text of the document.
   */
  text: string
  /**
   * Per-page text. Optional: some sources have no page structure. When present, the extractor can attribute a value to a page.
   */
  pages?: PageText[]
  /**
   * ISO 8601 date. Drives certificate expiry and reporting-period checks.
   */
  reporting_period_end?: string | null
  /**
   * Required for the legislated default-value mark-up to be applied. When absent, the default path returns a figure that understates the declarable amount and says so in a warning rather than omitting it silently.
   */
  reporting_year?: number | null
  jurisdiction: Jurisdiction
  ocr_quality?: OcrQuality
}

export interface ExtractedFieldDraft {
  field_name: string
  raw_value?: string | null
  raw_unit?: string | null
  /**
   * The exact verbatim text the value came from. Required for a reviewer to confirm anything; a field without it can only ever be Declared.
   */
  source_text?: string | null
  confidence: number
  /**
   * Nucleos's fine-grained extractor tag. Kept separate from Arbor's ExtractionMethod enum — see common.json EvidenceAtom.source.
   */
  extractor?: string | null
  /**
   * Per-field flags, verbatim. Same rule as the top-level flags array.
   */
  flags?: string[]
  evidence?: EvidenceAtom[]
}

export interface GoodsLineDraft {
  line_index: number
  cn_code?: string | null
  description?: string | null
  net_mass_kg?: number | null
  origin_country?: string | null
  production_route?: string | null
  installation_id?: string | null
  installation_name?: string | null
  direct_embedded_kgco2e?: number | null
  indirect_embedded_kgco2e?: number | null
  /**
   * What the document declared, when it declared one. A draft like every other field — the selector decides the operative method at calculation time.
   */
  emissions_method?: EmissionsMethod | null
  flags?: string[]
}

/**
 * Nucleos -> Arbor. Structured fields out.
 *
 * Every field is a DRAFT. Nothing here assigns a provenance tier: only a human action in Arbor's Review screen does that. Arbor writes these as ExtractedField rows and the reviewer decides.
 */
export interface CbamExtractionResult {
  document_id: string
  /**
   * What Nucleos decided the document actually is, which may differ from the document_type Arbor sent.
   */
  document_class?: string | null
  fields: ExtractedFieldDraft[]
  /**
   * Goods lines, when the document has them.
   */
  lines?: GoodsLineDraft[]
  /**
   * Nucleos's flag vocabulary, carried VERBATIM.
   *
   * These strings — flagReason, repair_failed:*, arbiter_conflict:*, claude_value_not_evidenced_in_text and the rest — are the anti-hallucination signals a reviewer needs. Never summarise, translate, group or prettify them in transit. A reviewer deciding whether to accept a value needs to know that the arbiter had a conflict and which extractors disagreed, not that 'there was an issue'.
   */
  flags: string[]
  engine: EngineVersions
}

export interface CprConsignment {
  consignment_reference: string
  origin_country: string
  embedded_tco2e: number
  /**
   * As paid, in the local currency. Never pre-converted by the caller: the conversion and its rate date belong in the result so both are auditable.
   */
  carbon_price_paid?: number | null
  /**
   * ISO 4217 of carbon_price_paid.
   */
  carbon_price_currency?: string | null
  /**
   * The origin-country carbon pricing scheme claimed against.
   */
  scheme?: string | null
  /**
   * Allowances the installation received free. Reduces the relief, because nothing was actually paid on them.
   */
  free_allocations_tco2e?: number | null
  /**
   * Rebates or refunds against the carbon price, in the same currency. Reduces the relief for the same reason.
   */
  rebates_received?: number | null
  /**
   * ISO 8601. Selects the exchange rate.
   */
  payment_date?: string | null
}

/**
 * Arbor -> Nucleos. Ask what carbon price relief a consignment qualifies for.
 */
export interface CprQuery {
  case_reference: string
  jurisdiction: Jurisdiction
  reporting_year: number
  consignments: CprConsignment[]
}

/**
 * Whether the claimed carbon price was verified.
 *
 * NON-BLOCKING but it MUST travel. An unverified relief claim is still payable and still reduces the liability, so refusing to return it would be wrong — but presenting it in the UI as though it were verified would be worse. Arbor's trust-display rules forbid confident styling on uncertain data, and this flag is what drives that.
 */
export type CprVerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'NOT_APPLICABLE'

export interface CprConsignmentResult {
  consignment_reference: string
  /**
   * The relief after conversion, free allocations, rebates and the cap.
   */
  relief_amount: number
  relief_currency: string
  carbon_price_local?: number | null
  carbon_price_currency?: string | null
  /**
   * Rate applied. Travels with the result so the figure can be reproduced without knowing which rate table was live at the time.
   */
  exchange_rate?: number | null
  exchange_rate_date?: string | null
  free_allocations_tco2e?: number | null
  rebates_received?: number | null
  /**
   * True when the relief was limited to the CBAM liability. Relief never exceeds the charge it offsets.
   */
  capped: boolean
  uncapped_amount?: number | null
  verification_status: CprVerificationStatus
  scheme?: string | null
  /**
   * Whether the scheme is on the qualifying list for this jurisdiction.
   */
  scheme_qualifying?: boolean | null
  warnings?: string[]
}

/**
 * Nucleos -> Arbor. What relief was computed, and on what basis.
 */
export interface CprResult {
  case_reference: string
  consignments: CprConsignmentResult[]
  engine: EngineVersions
}

export interface DeclarationLine {
  line_id: string
  cn_code: string
  description?: string | null
  net_mass_kg: number
  origin_country?: string | null
  production_route?: string | null
  installation_id?: string | null
  direct_embedded_kgco2e?: number | null
  indirect_embedded_kgco2e?: number | null
  supplier_direct_confidence?: number | null
  supplier_indirect_confidence?: number | null
  /**
   * Set by a human in Arbor's Review screen. Travels with the line so the calculation result can display both axes together. Nucleos reads this and never writes it.
   */
  provenance_tier: ProvenanceTier
  /**
   * The method the source document declared, if any. The selector may reject it — an implausible actual figure is downgraded — and the rejection is recorded in the result.
   */
  declared_emissions_method?: EmissionsMethod | null
}

/**
 * Arbor -> Nucleos. The confirmed goods lines to calculate on.
 *
 * Every line carries BOTH axes: the provenance tier a human set in Review, and the emissions method the document declared. Nucleos reads provenance_tier but never sets it.
 */
export interface DeclarationPayload {
  case_reference: string
  entity_id: string
  jurisdiction: Jurisdiction
  reporting_year: number
  reporting_quarter?: number | null
  lines: DeclarationLine[]
}

export interface SupplierDisplayContext {
  importer_name: string
  cn_code: string
  goods_description?: string | null
  net_mass_kg?: number | null
  origin_country?: string | null
  reporting_period?: string | null
}

/**
 * What the supplier returns. Three fields, and no more: every additional question measurably reduces the response rate, and these three are the minimum that produces a usable actual figure.
 */
export interface SupplierSubmission {
  /**
   * Direct specific embedded emissions, tCO2e per tonne. An intensity, not a total: it is multiplied by the goods line's net mass. Sending a total here would silently overstate every line by a factor of the mass in tonnes.
   */
  see_tco2e_per_t: number
  /**
   * Annex VI defaults are differentiated by production route, so this is what makes the submitted figure checkable against the right default.
   */
  production_route: string
  installation_name?: string | null
}

/**
 * Arbor -> Nucleos. Ask a supplier for the emissions data a goods line is missing.
 *
 * Its OWN shape, deliberately not Arbor's DataRequest. Arbor's request flow assembles answers by summarising certified Arbor records; this one asks for a specific intensity figure against a specific goods line and needs it multiplied into a mass-weighted total. Reusing DataRequest's answer-assembly would break the moment see_tco2e_per_t has to be combined with net mass.
 *
 * A DataRequest row may still be used to TRACK the outreach. Only the answer-assembly logic is off limits.
 */
export interface SupplierRequest {
  case_reference: string
  goods_line_id: string
  supplier_email?: string | null
  expires_at?: string | null
  /**
   * What the supplier sees. They are not an Arbor user and have no account, so everything needed to make the form comprehensible has to travel with the request.
   */
  display_context: SupplierDisplayContext
}
