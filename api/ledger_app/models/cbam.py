from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, Text, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ledger_app.models.base import Base


class CBAMCase(Base):
    __tablename__ = "cbam_cases"
    __table_args__ = {"schema": "cbam"}

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    importer_name: Mapped[str] = mapped_column(Text, nullable=False)
    importer_eori: Mapped[str] = mapped_column(Text, nullable=False)
    reporting_year: Mapped[int] = mapped_column(Integer, nullable=False)
    reporting_quarter: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))

    shipments: Mapped[list["CBAMShipment"]] = relationship(
        back_populates="cbam_case",
        cascade="all, delete-orphan",
    )


class CBAMShipment(Base):
    __tablename__ = "cbam_shipments"
    __table_args__ = {"schema": "cbam"}

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    case_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("cbam.cbam_cases.id", ondelete="CASCADE"),
        nullable=False,
    )
    import_date: Mapped[date] = mapped_column(Date, nullable=False)
    entry_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    incoterm: Mapped[str | None] = mapped_column(Text, nullable=True)
    origin_country: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))

    cbam_case: Mapped["CBAMCase"] = relationship(back_populates="shipments")
    goods_lines: Mapped[list["CBAMGoodsLine"]] = relationship(
        back_populates="shipment",
        cascade="all, delete-orphan",
    )


class CBAMGoodsLine(Base):
    __tablename__ = "cbam_goods_lines"
    __table_args__ = {"schema": "cbam"}

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    shipment_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("cbam.cbam_shipments.id", ondelete="CASCADE"),
        nullable=False,
    )
    cn_code: Mapped[str] = mapped_column(Text, nullable=False)
    sector: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    quantity_unit: Mapped[str] = mapped_column(Text, nullable=False)
    installation_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    installation_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    # CN code classification provenance
    cn_classification_confidence: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    cn_classification_method: Mapped[str | None] = mapped_column(Text, nullable=True)
    cn_requires_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))

    shipment: Mapped["CBAMShipment"] = relationship(back_populates="goods_lines")
    emissions: Mapped[list["CBAMEmission"]] = relationship(
        back_populates="goods_line",
        cascade="all, delete-orphan",
    )


class CBAMEmission(Base):
    __tablename__ = "cbam_emissions"
    __table_args__ = {"schema": "cbam"}

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    goods_line_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("cbam.cbam_goods_lines.id", ondelete="CASCADE"),
        nullable=False,
    )
    method: Mapped[str] = mapped_column(Text, nullable=False)
    direct_embedded_kgco2e: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    indirect_embedded_kgco2e: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    data_quality_score: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))

    goods_line: Mapped["CBAMGoodsLine"] = relationship(back_populates="emissions")
