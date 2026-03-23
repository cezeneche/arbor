from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


CBAMSector = Literal[
    "cement",
    "iron_steel",
    "aluminium",
    "fertilisers",
    "electricity",
    "hydrogen",
]

CBAMMethod = Literal["actual", "default", "estimated"]


class CBAMCaseCreate(BaseModel):
    importer_name: str = Field(..., min_length=1)
    importer_eori: str = Field(..., min_length=1)
    reporting_year: int
    reporting_quarter: int = Field(..., ge=1, le=4)
    status: str = "draft"


class CBAMCaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    importer_name: str
    importer_eori: str
    reporting_year: int
    reporting_quarter: int
    status: str
    created_at: datetime
    updated_at: datetime


class CBAMShipmentCreate(BaseModel):
    import_date: date
    entry_reference: str | None = None
    incoterm: str | None = None
    origin_country: str | None = None


class CBAMShipmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    case_id: UUID
    import_date: date
    entry_reference: str | None
    incoterm: str | None
    origin_country: str | None
    created_at: datetime


class CBAMGoodsLineCreate(BaseModel):
    cn_code: str = Field(..., min_length=1)
    sector: CBAMSector
    description: str | None = None
    quantity: Decimal
    quantity_unit: str = Field(..., min_length=1)
    installation_name: str | None = None
    installation_id: str | None = None


class CBAMGoodsLineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    shipment_id: UUID
    cn_code: str
    sector: CBAMSector
    description: str | None
    quantity: Decimal
    quantity_unit: str
    installation_name: str | None
    installation_id: str | None
    created_at: datetime


class CBAMEmissionsCreate(BaseModel):
    method: CBAMMethod = "estimated"
    direct_embedded_kgco2e: Decimal | None = None
    indirect_embedded_kgco2e: Decimal | None = None
    data_quality_score: Decimal | None = None
    notes: str | None = None


class CBAMEmissionsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    goods_line_id: UUID
    method: CBAMMethod
    direct_embedded_kgco2e: Decimal
    indirect_embedded_kgco2e: Decimal | None
    total_kgco2e: Decimal
    data_quality_score: Decimal | None
    notes: str | None
    version: int
    created_at: datetime


class CBAMGoodsLineSummary(BaseModel):
    goods_line_id: UUID
    cn_code: str
    sector: CBAMSector
    quantity: Decimal
    quantity_unit: str
    direct_kgco2e: Decimal
    indirect_kgco2e: Decimal
    total_kgco2e: Decimal


class CBAMSummaryTotals(BaseModel):
    direct_kgco2e: Decimal
    indirect_kgco2e: Decimal
    total_kgco2e: Decimal


class CBAMCaseSummaryRead(BaseModel):
    case_id: UUID
    totals: CBAMSummaryTotals
    goods_lines: list[CBAMGoodsLineSummary]


# ── Liability calculation schemas ─────────────────────────────────────────────

class CBAMLiabilityRequest(BaseModel):
    """Input for CBAM liability calculation (EU 2023/956 Arts. 9 and 21)."""
    eu_ets_price_eur: Decimal = Field(
        ..., gt=0,
        description="EU ETS allowance price for the reporting period (EUR/tCO2e).",
    )
    carbon_price_paid_eur: Decimal = Field(
        default=Decimal("0"), ge=0,
        description=(
            "Effective carbon price already paid in the origin country (EUR/tCO2e). "
            "0 when no recognised equivalent carbon pricing scheme applies "
            "(EU 2023/956 Art. 9)."
        ),
    )
    origin_country: str | None = Field(
        default=None,
        description=(
            "ISO 3166-1 alpha-2 origin country code. When supplied, the system "
            "auto-detects whether a recognised Art. 9 carbon pricing scheme applies."
        ),
    )


class GoodsLineSEERead(BaseModel):
    """SEE breakdown for a single goods line."""
    goods_line_id: str
    cn_code: str
    net_mass_kg: Decimal
    net_mass_t: Decimal
    direct_kgco2e: Decimal
    indirect_kgco2e: Decimal
    total_kgco2e: Decimal
    see_direct_tco2e_per_t: Decimal
    see_indirect_tco2e_per_t: Decimal
    see_total_tco2e_per_t: Decimal
    embedded_tco2e: Decimal


class CBAMLiabilityRead(BaseModel):
    """Full CBAM liability calculation result."""
    case_id: str
    eu_ets_price_eur: Decimal
    carbon_price_paid_eur: Decimal
    origin_country: str | None
    carbon_pricing_scheme_applies: bool
    carbon_pricing_scheme_name: str | None
    carbon_pricing_scheme_type: str | None
    goods_lines: list[GoodsLineSEERead]
    total_net_mass_t: Decimal
    total_direct_kgco2e: Decimal
    total_indirect_kgco2e: Decimal
    total_embedded_tco2e: Decimal
    carbon_price_deduction_tco2e: Decimal
    net_liability_tco2e: Decimal
    gross_financial_liability_eur: Decimal
    net_financial_liability_eur: Decimal
    cbam_certificates: int
    regulation_refs: list[str]
