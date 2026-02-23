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
