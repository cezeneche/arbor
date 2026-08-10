"""
Generated from contract/schemas. Do not edit by hand.

Regenerate with:  python contract/generate.py --python <out> --typescript <out>
Verify with:      python contract/generate.py --check
"""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EmissionsMethod(str, Enum):
    """
     Which emissions value entered the calculation.

     THIS IS NOT A TIER. Arbor carries a separate ProvenanceTier saying how much to trust a record's origin. The two axes are orthogonal and neither derives from the other: a mill certificate can legitimately be ACTUAL method and DECLARED provenance, because the figure is a real measurement and the document backing it was never verified. Both travel on every goods line and both display.

     Do not collapse these into one field. Every attempt to do so loses one of the two questions a reviewer has to answer.

     Regulation: EU 2023/1773 Art. 4 numbers these as tiers 1/2/3. That numbering travels as regulation_tier on a rejection reason, never as the name of this axis.
    """
    ACTUAL = "ACTUAL"
    ESTIMATED = "ESTIMATED"
    DEFAULT = "DEFAULT"


class ProvenanceTier(str, Enum):
    """
     How much to trust a record's origin. Arbor's axis.

     Set only by a human action in Arbor's Review screen. Extraction produces drafts; nothing crossing this boundary may assign a provenance tier. Nucleos never writes this field — it is echoed back so a goods line can carry both axes at once.

     See EmissionsMethod for why these are separate.
    """
    VERIFIED = "VERIFIED"
    DECLARED = "DECLARED"
    ESTIMATED = "ESTIMATED"


class Jurisdiction(str, Enum):
    EU = "EU"
    UK = "UK"


class PageText(BaseModel):
    """
     One page of extracted text. The page map lets a reviewer find a value in the source document without the document itself crossing the boundary.
    """

    model_config = ConfigDict(extra='forbid')

    page_number: int = Field(..., ge=1)
    text: str


class OcrQuality(BaseModel):
    """
     What the OCR pass knew about its own output. Arbor owns document-to-text from Phase 2, so this is the only signal Nucleos gets about how trustworthy the text is.
    """

    model_config = ConfigDict(extra='forbid')

    # 0-1 across the document, when the OCR engine reports it.
    mean_confidence: float | None = Field(None, ge=0, le=1)
    # True when any part of the source was not read. Never infer this from the reason string: a reason without the flag is metadata, not a truncation.
    truncated: bool
    truncation_reason: str | None = None
    # Which OCR path produced the text, for attributing a later accuracy regression.
    engine: str | None = None


class TextSpan(BaseModel):
    """
     Character offsets into the submitted text, so a reviewer can highlight the exact source of a value.
    """

    model_config = ConfigDict(extra='forbid')

    start: int = Field(..., ge=0)
    end: int = Field(..., ge=0)


class EvidenceAtom(BaseModel):
    """
     Where a value came from, in the source text.
    """

    model_config = ConfigDict(extra='forbid')

    field: str
    value: Any | None = None
    # Nucleos's own fine-grained extractor tag: rule_regex, claude, customs_parser, mill_cert_parser, arbiter, repair, and so on.
    #
    # Deliberately NOT Arbor's ExtractionMethod enum (DOCUMENT_AI | MANUAL_ENTRY | SYSTEM_INTEGRATION). Arbor's enum records how a record entered the platform; this records which of Nucleos's extractors produced a particular field. Mapping one onto the other loses the distinction that makes a flag actionable.
    source: str
    confidence: float = Field(..., ge=0, le=1)
    snippet: str | None = None
    page: int | None = None
    span: TextSpan | None = None


class RejectedMethod(BaseModel):
    """
     Why a higher-priority emissions method was not used. Mandatory audit trail: a declaration has to be able to say why it did not use actual data.
    """

    model_config = ConfigDict(extra='forbid')

    method: EmissionsMethod
    # The EU 2023/1773 Art. 4 tier number for this method. A citation, never the axis name.
    regulation_tier: int | None = None
    reason: str
    regulation_ref: str


class DecisionAtom(BaseModel):
    """
     One step of the calculation's decision trace, carried verbatim so an auditor can reconstruct the reasoning without re-running the engine.
    """

    model_config = ConfigDict(extra='forbid')

    step: str
    outcome: str
    detail: str
    value: Any | None = None
    regulation_ref: str | None = None


class EngineVersions(BaseModel):
    """
     Stamped into the response itself rather than inherited transitively, so a figure can be reproduced years later from the response alone.
    """

    model_config = ConfigDict(extra='forbid')

    engine_version: str
    annex_vi_factor_version: str | None = None
    markup_table_version: str | None = None
    regulation_reference: str | None = None


class CalculatedLine(BaseModel):

    model_config = ConfigDict(extra='forbid')

    line_id: str
    # The method the engine actually used. Separate from provenance_tier and never derived from it.
    emissions_method: EmissionsMethod
    # Echoed back from the declaration payload unchanged, so a goods line displays both axes without Arbor re-joining them. Nucleos does not set this.
    provenance_tier: ProvenanceTier
    direct_kgco2e: float
    indirect_kgco2e: float
    see_direct_tco2e_per_t: float | None = None
    see_indirect_tco2e_per_t: float | None = None
    see_total_tco2e_per_t: float | None = None
    embedded_tco2e: float
    # Default-value mark-up applied. Zero unless the default method was selected for a year with a legislated schedule.
    markup_fraction: float | None = None
    annex_vi_factor_used: bool | None = None
    # One entry per higher-priority method that was not used, with the reason. Required: a declaration must be able to say why it did not use actual data.
    rejected_methods: list[RejectedMethod] = Field(default_factory=list)
    # The full trace, verbatim.
    decision_trace: list[DecisionAtom] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class CalculationResult(BaseModel):
    """
     Nucleos -> Arbor. The computed declaration.

     Fails closed: a calculation that could not be completed returns an error rather than a partial figure. Arbor writes the result; Nucleos never writes to Arbor's database.
    """

    model_config = ConfigDict(extra='forbid')

    case_reference: str = Field(..., min_length=1)
    jurisdiction: Jurisdiction
    reporting_year: int
    reporting_quarter: int | None = None
    lines: list[CalculatedLine]
    total_embedded_tco2e: float | None = None
    # Verbatim, same rule as extraction flags.
    warnings: list[str] = Field(default_factory=list)
    engine: EngineVersions


class CbamExtractionRequest(BaseModel):
    """
     Arbor -> Nucleos. Text and metadata in.

     No blob reference and no bytes. From Phase 2 Arbor owns document-to-text and the storage bucket leaves Nucleos entirely, so a document identifier here is a handle for correlation and audit, never something Nucleos can dereference.
    """

    model_config = ConfigDict(extra='forbid')

    # Arbor's Document id. Correlation only — Nucleos cannot fetch it.
    document_id: str = Field(..., min_length=1)
    # Arbor's DocumentType. Nucleos routes on it but does not own the vocabulary.
    document_type: str = Field(..., min_length=1)
    # Arbor's Entity id. Scopes the request; Nucleos does not resolve it to a tenant of its own.
    entity_id: str = Field(..., min_length=1)
    # Full extracted text of the document.
    text: str
    # Per-page text. Optional: some sources have no page structure. When present, the extractor can attribute a value to a page.
    pages: list[PageText] = Field(default_factory=list)
    # ISO 8601 date. Drives certificate expiry and reporting-period checks.
    reporting_period_end: str | None = None
    # Required for the legislated default-value mark-up to be applied. When absent, the default path returns a figure that understates the declarable amount and says so in a warning rather than omitting it silently.
    reporting_year: int | None = None
    jurisdiction: Jurisdiction
    ocr_quality: OcrQuality | None = None


class ExtractedFieldDraft(BaseModel):

    model_config = ConfigDict(extra='forbid')

    field_name: str
    raw_value: str | None = None
    raw_unit: str | None = None
    # The exact verbatim text the value came from. Required for a reviewer to confirm anything; a field without it can only ever be Declared.
    source_text: str | None = None
    confidence: float = Field(..., ge=0, le=1)
    # Nucleos's fine-grained extractor tag. Kept separate from Arbor's ExtractionMethod enum — see common.json EvidenceAtom.source.
    extractor: str | None = None
    # Per-field flags, verbatim. Same rule as the top-level flags array.
    flags: list[str] = Field(default_factory=list)
    evidence: list[EvidenceAtom] = Field(default_factory=list)


class GoodsLineDraft(BaseModel):

    model_config = ConfigDict(extra='forbid')

    line_index: int = Field(..., ge=0)
    cn_code: str | None = None
    description: str | None = None
    net_mass_kg: float | None = None
    origin_country: str | None = None
    production_route: str | None = None
    installation_id: str | None = None
    installation_name: str | None = None
    direct_embedded_kgco2e: float | None = None
    indirect_embedded_kgco2e: float | None = None
    # What the document declared, when it declared one. A draft like every other field — the selector decides the operative method at calculation time.
    emissions_method: EmissionsMethod | None = None
    flags: list[str] = Field(default_factory=list)


class CbamExtractionResult(BaseModel):
    """
     Nucleos -> Arbor. Structured fields out.

     Every field is a DRAFT. Nothing here assigns a provenance tier: only a human action in Arbor's Review screen does that. Arbor writes these as ExtractedField rows and the reviewer decides.
    """

    model_config = ConfigDict(extra='forbid')

    document_id: str = Field(..., min_length=1)
    # What Nucleos decided the document actually is, which may differ from the document_type Arbor sent.
    document_class: str | None = None
    fields: list[ExtractedFieldDraft]
    # Goods lines, when the document has them.
    lines: list[GoodsLineDraft] = Field(default_factory=list)
    # Nucleos's flag vocabulary, carried VERBATIM.
    #
    # These strings — flagReason, repair_failed:*, arbiter_conflict:*, claude_value_not_evidenced_in_text and the rest — are the anti-hallucination signals a reviewer needs. Never summarise, translate, group or prettify them in transit. A reviewer deciding whether to accept a value needs to know that the arbiter had a conflict and which extractors disagreed, not that 'there was an issue'.
    flags: list[str]
    engine: EngineVersions


class CprConsignment(BaseModel):

    model_config = ConfigDict(extra='forbid')

    consignment_reference: str = Field(..., min_length=1)
    origin_country: str = Field(..., min_length=2)
    embedded_tco2e: float = Field(..., ge=0)
    # As paid, in the local currency. Never pre-converted by the caller: the conversion and its rate date belong in the result so both are auditable.
    carbon_price_paid: float | None = Field(None, ge=0)
    # ISO 4217 of carbon_price_paid.
    carbon_price_currency: str | None = None
    # The origin-country carbon pricing scheme claimed against.
    scheme: str | None = None
    # Allowances the installation received free. Reduces the relief, because nothing was actually paid on them.
    free_allocations_tco2e: float | None = Field(None, ge=0)
    # Rebates or refunds against the carbon price, in the same currency. Reduces the relief for the same reason.
    rebates_received: float | None = Field(None, ge=0)
    # ISO 8601. Selects the exchange rate.
    payment_date: str | None = None


class CprQuery(BaseModel):
    """
     Arbor -> Nucleos. Ask what carbon price relief a consignment qualifies for.
    """

    model_config = ConfigDict(extra='forbid')

    case_reference: str = Field(..., min_length=1)
    jurisdiction: Jurisdiction
    reporting_year: int
    consignments: list[CprConsignment] = Field(..., min_length=1)


class CprVerificationStatus(str, Enum):
    """
     Whether the claimed carbon price was verified.

     NON-BLOCKING but it MUST travel. An unverified relief claim is still payable and still reduces the liability, so refusing to return it would be wrong — but presenting it in the UI as though it were verified would be worse. Arbor's trust-display rules forbid confident styling on uncertain data, and this flag is what drives that.
    """
    VERIFIED = "VERIFIED"
    UNVERIFIED = "UNVERIFIED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class CprConsignmentResult(BaseModel):

    model_config = ConfigDict(extra='forbid')

    consignment_reference: str
    # The relief after conversion, free allocations, rebates and the cap.
    relief_amount: float = Field(..., ge=0)
    relief_currency: str
    carbon_price_local: float | None = None
    carbon_price_currency: str | None = None
    # Rate applied. Travels with the result so the figure can be reproduced without knowing which rate table was live at the time.
    exchange_rate: float | None = None
    exchange_rate_date: str | None = None
    free_allocations_tco2e: float | None = None
    rebates_received: float | None = None
    # True when the relief was limited to the CBAM liability. Relief never exceeds the charge it offsets.
    capped: bool
    uncapped_amount: float | None = None
    verification_status: CprVerificationStatus
    scheme: str | None = None
    # Whether the scheme is on the qualifying list for this jurisdiction.
    scheme_qualifying: bool | None = None
    warnings: list[str] = Field(default_factory=list)


class CprResult(BaseModel):
    """
     Nucleos -> Arbor. What relief was computed, and on what basis.
    """

    model_config = ConfigDict(extra='forbid')

    case_reference: str = Field(..., min_length=1)
    consignments: list[CprConsignmentResult]
    engine: EngineVersions


class DeclarationLine(BaseModel):

    model_config = ConfigDict(extra='forbid')

    line_id: str = Field(..., min_length=1)
    cn_code: str = Field(..., min_length=6)
    description: str | None = None
    net_mass_kg: float = Field(..., gt=0)
    origin_country: str | None = None
    production_route: str | None = None
    installation_id: str | None = None
    direct_embedded_kgco2e: float | None = None
    indirect_embedded_kgco2e: float | None = None
    supplier_direct_confidence: float | None = Field(None, ge=0, le=1)
    supplier_indirect_confidence: float | None = Field(None, ge=0, le=1)
    # Set by a human in Arbor's Review screen. Travels with the line so the calculation result can display both axes together. Nucleos reads this and never writes it.
    provenance_tier: ProvenanceTier
    # The method the source document declared, if any. The selector may reject it — an implausible actual figure is downgraded — and the rejection is recorded in the result.
    declared_emissions_method: EmissionsMethod | None = None


class DeclarationPayload(BaseModel):
    """
     Arbor -> Nucleos. The confirmed goods lines to calculate on.

     Every line carries BOTH axes: the provenance tier a human set in Review, and the emissions method the document declared. Nucleos reads provenance_tier but never sets it.
    """

    model_config = ConfigDict(extra='forbid')

    case_reference: str = Field(..., min_length=1)
    entity_id: str = Field(..., min_length=1)
    jurisdiction: Jurisdiction
    reporting_year: int
    reporting_quarter: int | None = Field(None, ge=1, le=4)
    lines: list[DeclarationLine] = Field(..., min_length=1)


class SupplierDisplayContext(BaseModel):

    model_config = ConfigDict(extra='forbid')

    importer_name: str
    cn_code: str
    goods_description: str | None = None
    net_mass_kg: float | None = None
    origin_country: str | None = None
    reporting_period: str | None = None


class SupplierSubmission(BaseModel):
    """
     What the supplier returns. Three fields, and no more: every additional question measurably reduces the response rate, and these three are the minimum that produces a usable actual figure.
    """

    model_config = ConfigDict(extra='forbid')

    # Direct specific embedded emissions, tCO2e per tonne. An intensity, not a total: it is multiplied by the goods line's net mass. Sending a total here would silently overstate every line by a factor of the mass in tonnes.
    see_tco2e_per_t: float = Field(..., gt=0)
    # Annex VI defaults are differentiated by production route, so this is what makes the submitted figure checkable against the right default.
    production_route: str = Field(..., min_length=1)
    installation_name: str | None = None


class SupplierRequest(BaseModel):
    """
     Arbor -> Nucleos. Ask a supplier for the emissions data a goods line is missing.

     Its OWN shape, deliberately not Arbor's DataRequest. Arbor's request flow assembles answers by summarising certified Arbor records; this one asks for a specific intensity figure against a specific goods line and needs it multiplied into a mass-weighted total. Reusing DataRequest's answer-assembly would break the moment see_tco2e_per_t has to be combined with net mass.

     A DataRequest row may still be used to TRACK the outreach. Only the answer-assembly logic is off limits.
    """

    model_config = ConfigDict(extra='forbid')

    case_reference: str = Field(..., min_length=1)
    goods_line_id: str = Field(..., min_length=1)
    supplier_email: str | None = None
    expires_at: str | None = None
    # What the supplier sees. They are not an Arbor user and have no account, so everything needed to make the form comprehensible has to travel with the request.
    display_context: SupplierDisplayContext
