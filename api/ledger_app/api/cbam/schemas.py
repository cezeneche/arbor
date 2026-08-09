from __future__ import annotations

from datetime import date
from decimal import Decimal
from enum import Enum
from pathlib import Path
from uuid import UUID

from pydantic import BaseModel, Field

ALLOWED_EMISSIONS_METHODS = ("actual", "default", "estimated")
CBAM_STORAGE_ROOT = Path("storage") / "cbam"


class EmissionsMethod(str, Enum):
    actual = "actual"
    default = "default"
    estimated = "estimated"


class CaseJurisdiction(str, Enum):
    """Regulatory output jurisdiction for a CBAM case (migration 009).

    UK   — produce UK HMRC return only (Finance No.2 Bill 2025-26)
    EU   — produce EU CBAM quarterly XML only (Reg 2023/956 / IR 2023/1773)
    BOTH — produce both outputs (importers with dual regulatory exposure)
    """

    UK = "UK"
    EU = "EU"
    BOTH = "BOTH"


class CBAMCaseCreate(BaseModel):
    importer_eori: str = Field(..., min_length=1)
    importer_name: str | None = None
    reporting_year: int
    reporting_quarter: int = Field(..., ge=1, le=4)
    jurisdiction: CaseJurisdiction = CaseJurisdiction.EU
    carbon_price_paid_third_country_eur: Decimal | None = None


class CBAMShipmentCreate(BaseModel):
    cbam_case_id: UUID
    origin_country: str | None = None
    customs_procedure: str | None = None


class CBAMGoodsLineCreate(BaseModel):
    shipment_id: UUID
    cn_code: str = Field(..., min_length=1)
    product_description: str | None = None
    net_mass_kg: Decimal = Field(..., gt=0)


class CBAMEmissionsCreate(BaseModel):
    goods_line_id: UUID
    direct_emissions_kgco2e: Decimal | None = None
    indirect_emissions_kgco2e: Decimal | None = None
    calculation_method: EmissionsMethod
    version: int = Field(..., ge=1)
    production_route: str | None = None


class CBAMLiabilityRequest(BaseModel):
    """Input for POST /cases/{case_id}/liability (EU 2023/956 Arts. 9 & 21)."""

    eu_ets_price_eur: Decimal = Field(
        ..., gt=0,
        description="EU ETS allowance price for the reporting period (EUR/tCO2e).",
    )
    carbon_price_paid_eur: Decimal = Field(
        default=Decimal("0"), ge=0,
        description=(
            "Effective carbon price already paid in origin country (EUR/tCO2e). "
            "0 when no recognised equivalent scheme applies (EU 2023/956 Art. 9)."
        ),
    )
    origin_country: str | None = Field(
        default=None,
        description=(
            "ISO 3166-1 alpha-2 origin country. When provided, the system "
            "auto-detects whether a recognised Art. 9 carbon pricing scheme applies."
        ),
    )


class CBAMScopeCheckRequest(BaseModel):
    """Input for POST /cbam/scope-check (EU 2023/956 Art. 2)."""

    cn_code: str = Field(..., min_length=1, description="EU CN code of the imported goods.")
    origin_country: str | None = Field(
        default=None,
        description="ISO 3166-1 alpha-2 country of origin (e.g. 'CN', 'IN').",
    )
    consignment_value_eur: Decimal | None = Field(
        default=None, ge=0,
        description="Intrinsic value of the consignment in EUR (excl. transport/insurance).",
    )
    importer_eori: str | None = Field(
        default=None,
        description="EU EORI of the importer or their customs representative.",
    )


class ParsedInvoiceImporter(BaseModel):
    name: str | None = None
    eori: str = Field(..., min_length=1)


class ParsedInvoiceMetadata(BaseModel):
    invoice_number: str | None = None
    invoice_date: date
    origin_country: str | None = None
    incoterm: str | None = None
    entry_reference: str | None = None
    consignment_reference: str | None = None
    customs_procedure_code: str | None = None
    net_weight_kg: Decimal | None = None
    is_temporary_admission: bool = False


class ParsedInvoiceLine(BaseModel):
    cn_code: str = Field(..., min_length=1)
    description: str | None = None
    quantity: Decimal | None = None
    quantity_unit: str | None = None
    net_mass_kg: Decimal | None = None
    method: EmissionsMethod | None = None
    direct_embedded_kgco2e: Decimal | None = None
    indirect_embedded_kgco2e: Decimal | None = None


class ParsedInvoiceEmissions(BaseModel):
    method: EmissionsMethod | None = None
    direct_embedded_kgco2e: Decimal | None = None
    indirect_embedded_kgco2e: Decimal | None = None


class CBAMDraftFromParsedInvoiceRequest(BaseModel):
    importer: ParsedInvoiceImporter
    invoice: ParsedInvoiceMetadata
    lines: list[ParsedInvoiceLine] = Field(..., min_length=1)
    emissions: ParsedInvoiceEmissions | None = None
    # Per-field evidence atoms, so an auditor can locate every value in the
    # source document.
    #
    # These used to be produced inside Nucleos by its own document ingestion.
    # Arbor owns document→text from Phase 2, so the evidence is produced there
    # and arrives here instead. Without it the report package's
    # extraction_evidence block and the explain-by-field endpoint are
    # permanently empty — the audit trail would quietly stop working rather
    # than visibly break.
    evidence: list[dict] | None = None
