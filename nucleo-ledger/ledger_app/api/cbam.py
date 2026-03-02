from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from ledger_app.db.session import engine
from ledger_app.schemas.evidence import EvidenceAtom
from ledger_app.services.cbam_arbiter import arbitrate_parsed_invoice
from ledger_app.services.cbam_data_quality import evaluate_cbam_data_quality
from ledger_app.services.cbam_explain import explain_field
from ledger_app.services.cbam_explain import explain_metric
from ledger_app.services.cbam_repair import repair_parsed_invoice
from ledger_app.services.document_text_extractor import extract_document_from_upload
from ledger_app.services.cbam_extractor import extract as extract_cbam_document
from ledger_app.services.gemini_structured_extractor import extract_structured_with_gemini
from ledger_app.services.llama_structured_extractor import compare_extractions
from ledger_app.services.llama_orchestrator import LlamaOrchestrator
from ledger_app.services.orchestration import llama_orchestrator as ingest_orchestrator
from ledger_app.services.snapshot_store import canonical_json
from ledger_app.services.snapshot_store import get_snapshot_store
from ledger_app.services.snapshot_store import sha256_hex

router = APIRouter(prefix="/cbam", tags=["cbam"])
ALLOWED_EMISSIONS_METHODS = ("actual", "default", "estimated")
CBAM_STORAGE_ROOT = Path("storage") / "cbam"
ENABLE_GEMINI_FALLBACK = os.getenv("ENABLE_GEMINI_FALLBACK", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
try:
    GEMINI_MATCH_THRESHOLD = float(os.getenv("GEMINI_MATCH_THRESHOLD", "0.4"))
except ValueError:
    GEMINI_MATCH_THRESHOLD = 0.4


class EmissionsMethod(str, Enum):
    actual = "actual"
    default = "default"
    estimated = "estimated"


class CBAMCaseCreate(BaseModel):
    importer_eori: str = Field(..., min_length=1)
    reporting_year: int
    reporting_quarter: int = Field(..., ge=1, le=4)


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
    direct_emissions_kgco2e: Decimal
    indirect_emissions_kgco2e: Decimal
    calculation_method: EmissionsMethod
    version: int = Field(..., ge=1)


class ParsedInvoiceImporter(BaseModel):
    name: str | None = None
    eori: str = Field(..., min_length=1)


class ParsedInvoiceMetadata(BaseModel):
    invoice_number: str | None = None
    invoice_date: date
    origin_country: str | None = None
    incoterm: str | None = None
    entry_reference: str | None = None


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


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def _table_columns(conn: Connection, table_name: str) -> dict[str, dict[str, str | None]]:
    rows = conn.execute(
        text(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'cbam' AND table_name = :table_name
            """
        ),
        {"table_name": table_name},
    ).mappings().all()

    if not rows:
        raise HTTPException(status_code=500, detail=f"Table cbam.{table_name} not found.")

    return {
        row["column_name"]: {
            "is_nullable": row["is_nullable"],
            "column_default": row["column_default"],
        }
        for row in rows
    }


def _pick_existing(columns: dict[str, dict[str, str | None]], options: list[str]) -> str | None:
    for name in options:
        if name in columns:
            return name
    return None


def _needs_explicit_value(columns: dict[str, dict[str, str | None]], name: str) -> bool:
    meta = columns.get(name)
    if not meta:
        return False
    return meta["is_nullable"] == "NO" and meta["column_default"] is None


def _manual_fk_check(conn: Connection, table_name: str, record_id: UUID, label: str) -> None:
    exists = conn.execute(
        text(f"SELECT 1 FROM cbam.{table_name} WHERE id = :id LIMIT 1"),
        {"id": str(record_id)},
    ).scalar_one_or_none()
    if exists is None:
        raise _bad_request(f"Invalid reference: {label} does not exist.")


def _quarter_from_date(value: date) -> int:
    return ((value.month - 1) // 3) + 1


def _infer_sector_from_cn_code(cn_code: str) -> str:
    normalized = "".join(ch for ch in cn_code if ch.isdigit())
    if normalized.startswith("2523"):
        return "cement"
    if normalized.startswith("2716"):
        return "electricity"
    if normalized.startswith("2804"):
        return "hydrogen"
    if normalized.startswith("31"):
        return "fertilisers"
    if normalized.startswith("76"):
        return "aluminium"
    if normalized.startswith(("72", "73")):
        return "iron_steel"
    return "iron_steel"


def _parse_iso_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _coerce_float(value, field_name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        try:
            return float(stripped)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid numeric value for {field_name}",
            ) from exc
    raise HTTPException(
        status_code=422,
        detail=f"Invalid numeric value for {field_name}",
    )


def _normalize_line_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


def _normalize_line_mass(value: object) -> str:
    numeric = _coerce_float(value, "line_mass")
    if numeric is None:
        return ""
    # Stable textual numeric representation for duplicate detection.
    return format(Decimal(str(numeric)).normalize(), "f")


def _line_fingerprint(
    cn_code: object,
    description: object,
    mass_value: object,
    quantity_unit: object,
) -> tuple[str, str, str, str]:
    # Deterministic duplicate key per shipment:
    # (cn_code, description, mass, quantity_unit)
    # These are stable across repeated ingestion of the same invoice line.
    return (
        _normalize_line_text(cn_code),
        _normalize_line_text(description),
        _normalize_line_mass(mass_value),
        _normalize_line_text(quantity_unit),
    )


def _normalized_evidence(evidence: object) -> list[dict[str, object]]:
    if not isinstance(evidence, list):
        return []
    normalized: list[dict[str, object]] = []
    for atom in evidence:
        if isinstance(atom, EvidenceAtom):
            normalized.append(atom.model_dump(mode="json"))
        elif isinstance(atom, dict):
            normalized.append(dict(atom))
    return normalized


def _append_llm_evidence(
    evidence: list[dict[str, object]],
    *,
    field: str,
    value: object,
    source: str = "llm",
    confidence: float = 0.35,
) -> None:
    if value in (None, ""):
        return
    evidence.append(
        EvidenceAtom(
            field=field,
            value=value,
            source=source,
            confidence=confidence,
            snippet=None,
        ).model_dump(mode="json")
    )


def _safe_snapshot_write(
    *,
    case_id: str,
    stage: str,
    payload: object,
    parent_hash: str | None = None,
    algo_versions: dict[str, object] | None = None,
    model_versions: dict[str, object] | None = None,
) -> str | None:
    try:
        snapshot = get_snapshot_store().append_snapshot(
            case_id=case_id,
            stage=stage,
            payload=payload,
            parent_hash=parent_hash,
            algo_versions=algo_versions,
            model_versions=model_versions,
        )
        return snapshot.payload_hash
    except Exception:
        # Snapshot persistence is additive and must not break API behavior.
        return parent_hash


def snapshot_cbam_compliance_pack(case_id: str, compliance_pack: object, parent_hash: str | None = None) -> str | None:
    return _safe_snapshot_write(
        case_id=case_id,
        stage="compliance_pack_v1",
        payload=compliance_pack,
        parent_hash=parent_hash,
        algo_versions={"compliance_pack_builder": "v1"},
        model_versions={},
    )


def _document_sha256_from_extraction_snapshot(case_id: str) -> str | None:
    try:
        snapshot = get_snapshot_store().latest_snapshot_by_stage(case_id, "extraction_v1")
    except Exception:
        return None
    if snapshot is None:
        return None

    try:
        payload = json.loads(snapshot.payload_json)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None

    raw_text = payload.get("raw_text")
    if not isinstance(raw_text, str) or not raw_text:
        return None
    return sha256_hex(raw_text)


def _report_package_audit_block(
    *,
    case_id: str,
    artifact_payload: dict[str, object],
    generated_at: str,
    snapshot_hash: str | None,
    parent_hash: str | None,
    algo_versions: dict[str, object] | None = None,
    model_versions: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "document_sha256": _document_sha256_from_extraction_snapshot(case_id),
        "payload_hash": sha256_hex(canonical_json(artifact_payload)),
        "snapshot_hash": snapshot_hash,
        "parent_hash": parent_hash,
        "algo_versions": algo_versions or {},
        "model_versions": model_versions or {},
        "generated_at": generated_at,
    }


def _build_parsed_invoice_request_from_extraction(
    extraction: dict[str, object],
    importer_name: str | None,
    importer_eori: str | None,
    reporting_year: int | None,
    reporting_quarter: int | None,
) -> tuple[CBAMDraftFromParsedInvoiceRequest, int, int, list[str]]:
    warnings: list[str] = []

    structured = extraction.get("structured")
    structured_data = structured if isinstance(structured, dict) else {}
    importer_data = extraction.get("importer")
    invoice_data = extraction.get("invoice")
    lines_data = extraction.get("lines")
    emissions_data = extraction.get("emissions")

    parsed_importer_name = (
        importer_name
        or (importer_data.get("name") if isinstance(importer_data, dict) else None)
        or structured_data.get("importer_name")
    )
    parsed_importer_eori = (
        importer_eori
        or (importer_data.get("eori") if isinstance(importer_data, dict) else None)
        or structured_data.get("importer_eori")
    )
    if not parsed_importer_eori:
        raise ValueError("importer_eori is required but was not found in form fields or extracted document.")

    parsed_invoice_number = None
    parsed_origin_country = None
    parsed_incoterm = None
    parsed_entry_reference = None
    parsed_invoice_date: date | None = None

    if isinstance(invoice_data, dict):
        parsed_invoice_number = invoice_data.get("invoice_number")
        parsed_origin_country = invoice_data.get("origin_country")
        parsed_incoterm = invoice_data.get("incoterm")
        parsed_entry_reference = invoice_data.get("entry_reference")
        parsed_invoice_date = _parse_iso_date(invoice_data.get("invoice_date"))

    if parsed_origin_country is None:
        parsed_origin_country = structured_data.get("origin_country")
    if parsed_invoice_date is None:
        parsed_invoice_date = _parse_iso_date(structured_data.get("invoice_date"))

    resolved_reporting_year = reporting_year
    resolved_reporting_quarter = reporting_quarter

    if resolved_reporting_year is None and parsed_invoice_date is not None:
        resolved_reporting_year = parsed_invoice_date.year
    if resolved_reporting_quarter is None and parsed_invoice_date is not None:
        resolved_reporting_quarter = _quarter_from_date(parsed_invoice_date)

    if resolved_reporting_year is None:
        resolved_reporting_year = date.today().year
        warnings.append("Missing reporting_year; defaulted to current year.")
    if resolved_reporting_quarter is None:
        resolved_reporting_quarter = 1
        warnings.append("Missing reporting_quarter; defaulted to Q1.")
    if resolved_reporting_quarter not in (1, 2, 3, 4):
        raise ValueError("reporting_quarter must be between 1 and 4.")

    if parsed_invoice_date is None:
        quarter_start_month = ((resolved_reporting_quarter - 1) * 3) + 1
        parsed_invoice_date = date(resolved_reporting_year, quarter_start_month, 1)
        warnings.append("Missing invoice_date; defaulted to first day of the resolved reporting quarter.")

    parsed_lines: list[dict[str, object]] = []
    if isinstance(lines_data, list) and lines_data:
        for line in lines_data:
            if isinstance(line, dict):
                quantity_value = _coerce_float(line.get("quantity"), "quantity")
                net_mass_value = _coerce_float(line.get("net_mass_kg"), "net_mass_kg")
                line_direct_value = _coerce_float(
                    line.get("direct_embedded_kgco2e"),
                    "direct_embedded_kgco2e",
                )
                line_indirect_value = _coerce_float(
                    line.get("indirect_embedded_kgco2e"),
                    "indirect_embedded_kgco2e",
                )
                parsed_lines.append(
                    {
                        "cn_code": line.get("cn_code"),
                        "description": line.get("description"),
                        "quantity": quantity_value,
                        "quantity_unit": line.get("quantity_unit"),
                        "net_mass_kg": net_mass_value,
                        "method": line.get("method"),
                        "direct_embedded_kgco2e": line_direct_value,
                        "indirect_embedded_kgco2e": line_indirect_value,
                    }
                )
    else:
        cn_code = structured_data.get("cn_code")
        if cn_code:
            structured_mass = _coerce_float(structured_data.get("net_mass_kg"), "net_mass_kg")
            parsed_lines.append(
                {
                    "cn_code": cn_code,
                    "description": None,
                    "quantity": structured_mass,
                    "quantity_unit": "kg",
                    "net_mass_kg": structured_mass,
                    "method": None,
                    "direct_embedded_kgco2e": None,
                    "indirect_embedded_kgco2e": None,
                }
            )

    if not parsed_lines:
        raise ValueError("No invoice lines were extracted from the document.")

    parsed_emissions: dict[str, object] | None = None
    if isinstance(emissions_data, dict):
        parsed_emissions = {
            "method": emissions_data.get("method"),
            "direct_embedded_kgco2e": _coerce_float(
                emissions_data.get("direct_embedded_kgco2e"),
                "direct_embedded_kgco2e",
            ),
            "indirect_embedded_kgco2e": _coerce_float(
                emissions_data.get("indirect_embedded_kgco2e"),
                "indirect_embedded_kgco2e",
            ),
        }
    elif (
        structured_data.get("method") is not None
        or structured_data.get("direct_embedded_kgco2e") is not None
        or structured_data.get("indirect_embedded_kgco2e") is not None
    ):
        parsed_emissions = {
            "method": structured_data.get("method"),
            "direct_embedded_kgco2e": _coerce_float(
                structured_data.get("direct_embedded_kgco2e"),
                "direct_embedded_kgco2e",
            ),
            "indirect_embedded_kgco2e": _coerce_float(
                structured_data.get("indirect_embedded_kgco2e"),
                "indirect_embedded_kgco2e",
            ),
        }

    payload = CBAMDraftFromParsedInvoiceRequest(
        importer={
            "name": parsed_importer_name,
            "eori": str(parsed_importer_eori),
        },
        invoice={
            "invoice_number": parsed_invoice_number,
            "invoice_date": parsed_invoice_date,
            "origin_country": parsed_origin_country,
            "incoterm": parsed_incoterm,
            "entry_reference": parsed_entry_reference,
        },
        lines=parsed_lines,
        emissions=parsed_emissions,
    )
    return payload, resolved_reporting_year, resolved_reporting_quarter, warnings


def _llama_candidate_from_structured_invoice(
    rule_candidate: dict[str, object],
    llama_output,
    raw_text: str,
    layout_payload: dict[str, object] | None,
) -> dict[str, object] | None:
    if llama_output is None:
        return None

    if hasattr(llama_output, "model_dump"):
        llama_data = llama_output.model_dump()
    elif isinstance(llama_output, dict):
        llama_data = llama_output
    else:
        return None

    if not isinstance(llama_data, dict):
        return None

    line_items = llama_data.get("line_items")
    normalized_lines: list[dict[str, object]] = []
    if isinstance(line_items, list):
        for item in line_items:
            if not isinstance(item, dict):
                continue
            quantity = item.get("quantity")
            normalized_lines.append(
                {
                    "cn_code": item.get("cn_code"),
                    "description": item.get("description"),
                    "quantity": quantity,
                    "quantity_unit": "kg" if quantity is not None else None,
                    "net_mass_kg": quantity,
                }
            )

    has_signal = any(
        llama_data.get(field)
        for field in ("importer_name", "invoice_number", "invoice_date", "origin_country")
    ) or bool(normalized_lines)
    if not has_signal:
        return None

    base_importer = rule_candidate.get("importer")
    base_invoice = rule_candidate.get("invoice")
    base_importer_eori = base_importer.get("eori") if isinstance(base_importer, dict) else None
    base_incoterm = base_invoice.get("incoterm") if isinstance(base_invoice, dict) else None
    base_entry_reference = base_invoice.get("entry_reference") if isinstance(base_invoice, dict) else None
    evidence: list[dict[str, object]] = []

    _append_llm_evidence(evidence, field="invoice.invoice_number", value=llama_data.get("invoice_number"))
    _append_llm_evidence(evidence, field="invoice.invoice_date", value=llama_data.get("invoice_date"))
    _append_llm_evidence(evidence, field="invoice.origin_country", value=llama_data.get("origin_country"))
    for idx, line in enumerate(normalized_lines):
        _append_llm_evidence(evidence, field=f"lines[{idx}].cn_code", value=line.get("cn_code"))
        _append_llm_evidence(evidence, field=f"lines[{idx}].net_mass_kg", value=line.get("net_mass_kg"))

    return {
        "source": "llama",
        "importer": {
            "name": llama_data.get("importer_name"),
            "eori": base_importer_eori,
        },
        "invoice": {
            "invoice_number": llama_data.get("invoice_number"),
            "invoice_date": llama_data.get("invoice_date"),
            "origin_country": llama_data.get("origin_country"),
            "incoterm": base_incoterm,
            "entry_reference": base_entry_reference,
        },
        "lines": normalized_lines,
        "emissions": rule_candidate.get("emissions"),
        "structured": rule_candidate.get("structured"),
        "layout": layout_payload,
        "full_text": raw_text,
        "evidence": evidence,
    }


def _parsed_data_quality_precheck_from_payload(
    payload: CBAMDraftFromParsedInvoiceRequest,
    reporting_year: int,
    reporting_quarter: int,
) -> dict[str, object]:
    case_row: dict[str, object] = {
        "id": "draft_case",
        "importer_eori": payload.importer.eori,
        "reporting_year": reporting_year,
        "reporting_quarter": reporting_quarter,
    }

    shipment_row: dict[str, object] = {
        "id": "draft_shipment",
        "origin_country": payload.invoice.origin_country,
        "invoice_number": payload.invoice.invoice_number or payload.invoice.entry_reference,
        "entry_reference": payload.invoice.entry_reference,
        "incoterm": payload.invoice.incoterm,
    }

    goods_payload: list[dict[str, object]] = []
    for idx, line in enumerate(payload.lines):
        goods_line = {
            "id": f"draft_goods_{idx}",
            "cn_code": line.cn_code,
            "quantity": _coerce_float(line.quantity, "quantity"),
            "net_mass_kg": _coerce_float(line.net_mass_kg, "net_mass_kg"),
            "installation_id": None,
        }
        latest_emissions = None
        if (
            line.method is not None
            or line.direct_embedded_kgco2e is not None
            or line.indirect_embedded_kgco2e is not None
        ):
            latest_emissions = {
                "method": line.method.value if line.method is not None else None,
                "direct_embedded_kgco2e": _coerce_float(line.direct_embedded_kgco2e, "direct_embedded_kgco2e"),
                "indirect_embedded_kgco2e": _coerce_float(line.indirect_embedded_kgco2e, "indirect_embedded_kgco2e"),
            }
        elif payload.emissions is not None:
            latest_emissions = {
                "method": payload.emissions.method.value if payload.emissions.method is not None else None,
                "direct_embedded_kgco2e": _coerce_float(
                    payload.emissions.direct_embedded_kgco2e,
                    "direct_embedded_kgco2e",
                ),
                "indirect_embedded_kgco2e": _coerce_float(
                    payload.emissions.indirect_embedded_kgco2e,
                    "indirect_embedded_kgco2e",
                ),
            }

        goods_payload.append({"goods_line": goods_line, "latest_emissions": latest_emissions})

    shipments_payload = [{"shipment": shipment_row, "goods_lines": goods_payload}]
    return evaluate_cbam_data_quality(case_row, shipments_payload)


def _insert_returning(
    conn: Connection,
    table_name: str,
    payload: dict[str, object],
) -> dict[str, object]:
    cols = ", ".join(payload.keys())
    vals = ", ".join(f":{name}" for name in payload)
    row = conn.execute(
        text(f"INSERT INTO cbam.{table_name} ({cols}) VALUES ({vals}) RETURNING *"),
        payload,
    ).mappings().one()
    return dict(row)


def _build_case_summary(conn: Connection, case_id: UUID) -> dict[str, object]:
    shipments_cols = _table_columns(conn, "cbam_shipments")
    goods_cols = _table_columns(conn, "cbam_goods_lines")
    emissions_cols = _table_columns(conn, "cbam_emissions")

    case_fk_column = _pick_existing(shipments_cols, ["cbam_case_id", "case_id"])
    if not case_fk_column:
        raise HTTPException(status_code=500, detail="No case FK column found on cbam_shipments.")

    net_mass_col = _pick_existing(goods_cols, ["net_mass_kg", "quantity"])
    if not net_mass_col:
        raise HTTPException(status_code=500, detail="No goods mass column found on cbam_goods_lines.")

    direct_col = _pick_existing(emissions_cols, ["direct_emissions_kgco2e", "direct_embedded_kgco2e"])
    indirect_col = _pick_existing(emissions_cols, ["indirect_emissions_kgco2e", "indirect_embedded_kgco2e"])
    if not direct_col or not indirect_col:
        raise HTTPException(status_code=500, detail="Expected emissions columns not found on cbam_emissions.")

    summary = conn.execute(
        text(
            f"""
            WITH latest_emissions AS (
                SELECT e.goods_line_id, e.{direct_col} AS direct_emissions, e.{indirect_col} AS indirect_emissions
                FROM cbam.cbam_emissions e
                INNER JOIN (
                    SELECT goods_line_id, MAX(version) AS max_version
                    FROM cbam.cbam_emissions
                    GROUP BY goods_line_id
                ) mx
                    ON mx.goods_line_id = e.goods_line_id
                   AND mx.max_version = e.version
            )
            SELECT
                COUNT(gl.id) AS total_goods_lines,
                COALESCE(SUM(gl.{net_mass_col}), 0) AS total_net_mass_kg,
                COALESCE(SUM(le.direct_emissions), 0) AS total_direct_emissions_kgco2e,
                COALESCE(SUM(le.indirect_emissions), 0) AS total_indirect_emissions_kgco2e
            FROM cbam.cbam_goods_lines gl
            INNER JOIN cbam.cbam_shipments s ON s.id = gl.shipment_id
            LEFT JOIN latest_emissions le ON le.goods_line_id = gl.id
            WHERE s.{case_fk_column} = :case_id
            """
        ),
        {"case_id": str(case_id)},
    ).mappings().one()

    direct = Decimal(summary["total_direct_emissions_kgco2e"] or 0)
    indirect = Decimal(summary["total_indirect_emissions_kgco2e"] or 0)

    return {
        "case_id": str(case_id),
        "total_goods_lines": int(summary["total_goods_lines"] or 0),
        "total_net_mass_kg": Decimal(summary["total_net_mass_kg"] or 0),
        "total_direct_emissions_kgco2e": direct,
        "total_indirect_emissions_kgco2e": indirect,
        "total_embedded_emissions_kgco2e": direct + indirect,
    }


def _build_case_shipments_payload(conn: Connection, case_id: UUID) -> list[dict[str, object]]:
    shipments_cols = _table_columns(conn, "cbam_shipments")
    goods_cols = _table_columns(conn, "cbam_goods_lines")
    emissions_cols = _table_columns(conn, "cbam_emissions")

    case_fk_column = _pick_existing(shipments_cols, ["cbam_case_id", "case_id"])
    if not case_fk_column:
        raise HTTPException(status_code=500, detail="No case FK column found on cbam_shipments.")

    shipment_order_by = "created_at ASC, id ASC" if "created_at" in shipments_cols else "id ASC"
    shipment_rows = conn.execute(
        text(
            f"""
            SELECT *
            FROM cbam.cbam_shipments
            WHERE {case_fk_column} = :case_id
            ORDER BY {shipment_order_by}
            """
        ),
        {"case_id": str(case_id)},
    ).mappings().all()

    goods_order_by = "created_at ASC, id ASC" if "created_at" in goods_cols else "id ASC"
    emissions_order_by_parts: list[str] = ["version DESC"]
    if "created_at" in emissions_cols:
        emissions_order_by_parts.append("created_at DESC")
    emissions_order_by_parts.append("id DESC")
    emissions_order_by = ", ".join(emissions_order_by_parts)

    shipments_payload: list[dict[str, object]] = []
    for shipment_row in shipment_rows:
        shipment = dict(shipment_row)
        goods_rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_goods_lines
                WHERE shipment_id = :shipment_id
                ORDER BY {goods_order_by}
                """
            ),
            {"shipment_id": str(shipment["id"])},
        ).mappings().all()

        goods_payload: list[dict[str, object]] = []
        for goods_line_row in goods_rows:
            goods_line = dict(goods_line_row)
            emissions_rows = conn.execute(
                text(
                    f"""
                    SELECT *
                    FROM cbam.cbam_emissions
                    WHERE goods_line_id = :goods_line_id
                    ORDER BY {emissions_order_by}
                    LIMIT 1
                    """
                ),
                {"goods_line_id": str(goods_line["id"])},
            ).mappings().all()
            latest_emissions = dict(emissions_rows[0]) if emissions_rows else None
            goods_payload.append(
                {
                    "goods_line": goods_line,
                    "latest_emissions": latest_emissions,
                }
            )

        shipments_payload.append(
            {
                "shipment": shipment,
                "goods_lines": goods_payload,
            }
        )

    return shipments_payload


@router.post("/cases", status_code=status.HTTP_201_CREATED)
def create_cbam_case(payload: CBAMCaseCreate):
    with engine.begin() as conn:
        columns = _table_columns(conn, "cbam_cases")

        insert_payload: dict[str, object] = {
            "id": str(uuid4()),
            "importer_eori": payload.importer_eori,
            "reporting_year": payload.reporting_year,
            "reporting_quarter": payload.reporting_quarter,
        }

        if "importer_name" in columns:
            insert_payload["importer_name"] = payload.importer_eori
        if "status" in columns:
            insert_payload["status"] = "draft"

        created = _insert_returning(conn, "cbam_cases", insert_payload)
        return created


@router.get("/cases/{case_id}")
def get_cbam_case(case_id: UUID):
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT *
                FROM cbam.cbam_cases
                WHERE id = :id
                LIMIT 1
                """
            ),
            {"id": str(case_id)},
        ).mappings().all()

        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

        return dict(rows[0])


@router.get("/cases")
def list_cbam_cases(
    importer_eori: str | None = None,
    reporting_year: int | None = None,
    reporting_quarter: int | None = Query(default=None, ge=1, le=4),
):
    with engine.begin() as conn:
        columns = _table_columns(conn, "cbam_cases")
        order_by = (
            "created_at DESC"
            if "created_at" in columns
            else "reporting_year DESC, reporting_quarter DESC"
        )

        filters: list[str] = []
        params: dict[str, object] = {}

        if importer_eori is not None:
            filters.append("importer_eori = :importer_eori")
            params["importer_eori"] = importer_eori
        if reporting_year is not None:
            filters.append("reporting_year = :reporting_year")
            params["reporting_year"] = reporting_year
        if reporting_quarter is not None:
            filters.append("reporting_quarter = :reporting_quarter")
            params["reporting_quarter"] = reporting_quarter

        where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""
        rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_cases
                {where_sql}
                ORDER BY {order_by}
                """
            ),
            params,
        ).mappings().all()

        return [dict(row) for row in rows]


@router.post("/cases/{case_id}/documents", status_code=status.HTTP_201_CREATED)
async def create_cbam_document(case_id: UUID, file: UploadFile = File(...)):
    with engine.begin() as conn:
        _manual_fk_check(conn, "cbam_cases", case_id, "case_id")

    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File name is required.")

    document_id = str(uuid4())
    safe_filename = Path(file.filename).name
    target_dir = CBAM_STORAGE_ROOT / str(case_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    stored_path = target_dir / f"{document_id}_{safe_filename}"

    content = await file.read()
    stored_path.write_bytes(content)
    extraction = extract_cbam_document(str(stored_path))

    return {
        "case_id": str(case_id),
        "document_id": document_id,
        "stored_path": str(stored_path),
        "extraction": extraction,
    }


def _create_cbam_draft_from_parsed_invoice_payload(
    payload: CBAMDraftFromParsedInvoiceRequest,
    reporting_year_override: int | None = None,
    reporting_quarter_override: int | None = None,
    warn_on_missing_emissions: bool = False,
) -> dict[str, object]:
    with engine.begin() as conn:
        case_columns = _table_columns(conn, "cbam_cases")
        shipment_columns = _table_columns(conn, "cbam_shipments")
        goods_columns = _table_columns(conn, "cbam_goods_lines")
        emissions_columns = _table_columns(conn, "cbam_emissions")

        reporting_year = (
            reporting_year_override
            if reporting_year_override is not None
            else payload.invoice.invoice_date.year
        )
        reporting_quarter = (
            reporting_quarter_override
            if reporting_quarter_override is not None
            else _quarter_from_date(payload.invoice.invoice_date)
        )
        warnings: list[str] = []

        existing_case_rows = conn.execute(
            text(
                """
                SELECT *
                FROM cbam.cbam_cases
                WHERE importer_eori = :importer_eori
                  AND reporting_year = :reporting_year
                  AND reporting_quarter = :reporting_quarter
                ORDER BY created_at DESC
                LIMIT 1
                """
            ),
            {
                "importer_eori": payload.importer.eori,
                "reporting_year": reporting_year,
                "reporting_quarter": reporting_quarter,
            },
        ).mappings().all()

        if existing_case_rows:
            case_id = str(existing_case_rows[0]["id"])
        else:
            case_insert: dict[str, object] = {
                "id": str(uuid4()),
                "importer_eori": payload.importer.eori,
                "reporting_year": reporting_year,
                "reporting_quarter": reporting_quarter,
            }
            if "importer_name" in case_columns:
                case_insert["importer_name"] = payload.importer.name or payload.importer.eori
            if "status" in case_columns:
                case_insert["status"] = "draft"

            case_row = _insert_returning(conn, "cbam_cases", case_insert)
            case_id = str(case_row["id"])

        case_fk_column = _pick_existing(shipment_columns, ["cbam_case_id", "case_id"])
        if not case_fk_column:
            raise HTTPException(status_code=500, detail="No case FK column found on cbam_shipments.")

        invoice_number = payload.invoice.invoice_number
        matched_shipment: dict[str, object] | None = None
        if invoice_number:
            shipment_order_by = "created_at DESC, id DESC" if "created_at" in shipment_columns else "id DESC"
            existing_shipments = conn.execute(
                text(
                    f"""
                    SELECT *
                    FROM cbam.cbam_shipments
                    WHERE {case_fk_column} = :case_id
                    ORDER BY {shipment_order_by}
                    """
                ),
                {"case_id": case_id},
            ).mappings().all()

            for row in existing_shipments:
                shipment = dict(row)
                if "invoice_number" in shipment_columns and shipment.get("invoice_number") == invoice_number:
                    matched_shipment = shipment
                    break
                if shipment.get("entry_reference") == invoice_number:
                    matched_shipment = shipment
                    break

        if matched_shipment is not None:
            shipment_id = str(matched_shipment["id"])
            warnings.append(
                f"Reused existing shipment for invoice_number={invoice_number}."
            )
        else:
            shipment_insert: dict[str, object] = {
                "id": str(uuid4()),
                case_fk_column: case_id,
            }

            if "origin_country" in shipment_columns:
                shipment_insert["origin_country"] = payload.invoice.origin_country
            if "incoterm" in shipment_columns:
                shipment_insert["incoterm"] = payload.invoice.incoterm
            if "invoice_number" in shipment_columns:
                shipment_insert["invoice_number"] = payload.invoice.invoice_number
            if "entry_reference" in shipment_columns:
                shipment_insert["entry_reference"] = (
                    payload.invoice.invoice_number
                    if payload.invoice.invoice_number
                    else payload.invoice.entry_reference
                )
            if _needs_explicit_value(shipment_columns, "import_date") or "import_date" in shipment_columns:
                shipment_insert["import_date"] = payload.invoice.invoice_date

            shipment_row = _insert_returning(conn, "cbam_shipments", shipment_insert)
            shipment_id = str(shipment_row["id"])

        direct_col = _pick_existing(
            emissions_columns, ["direct_emissions_kgco2e", "direct_embedded_kgco2e"]
        )
        indirect_col = _pick_existing(
            emissions_columns, ["indirect_emissions_kgco2e", "indirect_embedded_kgco2e"]
        )
        method_col = _pick_existing(emissions_columns, ["calculation_method", "method"])
        goods_line_fk_column = _pick_existing(emissions_columns, ["goods_line_id"])

        goods_order_by = "created_at ASC, id ASC" if "created_at" in goods_columns else "id ASC"
        existing_goods_rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM cbam.cbam_goods_lines
                WHERE shipment_id = :shipment_id
                ORDER BY {goods_order_by}
                """
            ),
            {"shipment_id": shipment_id},
        ).mappings().all()
        existing_goods_by_fp: dict[tuple[str, str, str, str], str] = {}
        description_col = "product_description" if "product_description" in goods_columns else "description"
        mass_col = "net_mass_kg" if "net_mass_kg" in goods_columns else "quantity"
        for row in existing_goods_rows:
            fp = _line_fingerprint(
                row.get("cn_code"),
                row.get(description_col),
                row.get(mass_col),
                row.get("quantity_unit"),
            )
            if fp not in existing_goods_by_fp:
                existing_goods_by_fp[fp] = str(row["id"])

        goods_line_ids: list[str] = []
        emissions_ids: list[str] = []

        for line in payload.lines:
            line_quantity = _coerce_float(line.quantity, "quantity")
            line_net_mass = _coerce_float(line.net_mass_kg, "net_mass_kg")
            line_mass = line_net_mass if line_net_mass is not None else line_quantity
            line_unit = line.quantity_unit or "kg"
            line_fp = _line_fingerprint(
                line.cn_code,
                line.description,
                line_mass,
                line_unit,
            )

            if line_fp in existing_goods_by_fp:
                goods_line_id = existing_goods_by_fp[line_fp]
                warnings.append(f"goods_line_reused:{line.cn_code}")
            else:
                goods_insert: dict[str, object] = {
                    "id": str(uuid4()),
                    "shipment_id": shipment_id,
                    "cn_code": line.cn_code,
                }

                if "product_description" in goods_columns:
                    goods_insert["product_description"] = line.description
                elif "description" in goods_columns:
                    goods_insert["description"] = line.description

                if "net_mass_kg" in goods_columns:
                    mass = line_net_mass if line_net_mass is not None else line_quantity
                    if mass is None:
                        mass = Decimal("0")
                        warnings.append(
                            f"No quantity or net_mass_kg provided for cn_code={line.cn_code}; defaulted net_mass_kg to 0."
                        )
                    goods_insert["net_mass_kg"] = mass
                elif "quantity" in goods_columns:
                    quantity = line_quantity if line_quantity is not None else line_net_mass
                    if quantity is None:
                        quantity = Decimal("0")
                        warnings.append(
                            f"No quantity or net_mass_kg provided for cn_code={line.cn_code}; defaulted quantity to 0."
                        )
                    goods_insert["quantity"] = quantity
                    if "quantity_unit" in goods_columns:
                        goods_insert["quantity_unit"] = line.quantity_unit or "kg"

                if "quantity_unit" in goods_columns and "quantity_unit" not in goods_insert:
                    goods_insert["quantity_unit"] = line.quantity_unit or "kg"

                if _needs_explicit_value(goods_columns, "sector") or "sector" in goods_columns:
                    goods_insert["sector"] = _infer_sector_from_cn_code(line.cn_code)

                goods_row = _insert_returning(conn, "cbam_goods_lines", goods_insert)
                goods_line_id = str(goods_row["id"])
                existing_goods_by_fp[line_fp] = goods_line_id

            goods_line_ids.append(goods_line_id)

            emissions_payload = payload.emissions
            line_method = line.method if line.method is not None else (
                emissions_payload.method if emissions_payload else None
            )
            line_direct_source = (
                line.direct_embedded_kgco2e
                if line.direct_embedded_kgco2e is not None
                else (emissions_payload.direct_embedded_kgco2e if emissions_payload else None)
            )
            line_indirect_source = (
                line.indirect_embedded_kgco2e
                if line.indirect_embedded_kgco2e is not None
                else (emissions_payload.indirect_embedded_kgco2e if emissions_payload else None)
            )

            if (
                line_method is not None
                and direct_col
                and indirect_col
                and method_col
                and goods_line_fk_column
            ):
                existing_line_emissions = conn.execute(
                    text(
                        """
                        SELECT *
                        FROM cbam.cbam_emissions
                        WHERE goods_line_id = :goods_line_id
                        ORDER BY version DESC, id DESC
                        """
                    ),
                    {"goods_line_id": goods_line_id},
                ).mappings().all()
                existing_same_version = next(
                    (row for row in existing_line_emissions if int(row.get("version") or 0) == 1),
                    None,
                )
                if existing_same_version is not None:
                    emissions_ids.append(str(existing_same_version["id"]))
                    warnings.append(f"emissions_reused:{goods_line_id}")
                    continue

                direct_value = _coerce_float(line_direct_source, "direct_embedded_kgco2e")
                indirect_value = _coerce_float(line_indirect_source, "indirect_embedded_kgco2e")
                emissions_insert: dict[str, object] = {
                    "id": str(uuid4()),
                    goods_line_fk_column: goods_line_id,
                    direct_col: direct_value if direct_value is not None else Decimal("0"),
                    indirect_col: indirect_value if indirect_value is not None else Decimal("0"),
                    method_col: line_method.value,
                    "version": 1,
                }
                emissions_row = _insert_returning(conn, "cbam_emissions", emissions_insert)
                emissions_ids.append(str(emissions_row["id"]))
            elif warn_on_missing_emissions:
                warnings.append("emissions_missing")

        return {
            "case_id": case_id,
            "shipment_id": shipment_id,
            "goods_line_ids": goods_line_ids,
            "emissions_ids": emissions_ids,
            "warnings": warnings,
        }


@router.post("/drafts/from-parsed-invoice", status_code=status.HTTP_201_CREATED)
def create_cbam_draft_from_parsed_invoice(payload: CBAMDraftFromParsedInvoiceRequest):
    try:
        return _create_cbam_draft_from_parsed_invoice_payload(payload)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "cbam_draft_create_failed", "message": str(exc.orig) if exc.orig else str(exc)},
        )


@router.post("/drafts/from-document", status_code=status.HTTP_201_CREATED)
async def create_cbam_draft_from_document(
    file: UploadFile = File(...),
    importer_name: str | None = Form(default=None),
    importer_eori: str | None = Form(default=None),
    reporting_year: int | None = Form(default=None),
    reporting_quarter: int | None = Form(default=None),
):
    if not file.filename:
        return JSONResponse(
            status_code=422,
            content={"detail": "File name is required.", "stage": "extract"},
        )

    safe_filename = Path(file.filename).name or "upload.bin"

    try:
        file_bytes = await file.read()
        try:
            # Keep these assignments explicit so test monkeypatches on cbam_api symbols
            # continue to control the orchestration flow.
            ingest_orchestrator.extract_document_from_upload = extract_document_from_upload
            ingest_orchestrator.extract_cbam_document = extract_cbam_document
            ingest_orchestrator.LlamaOrchestrator = LlamaOrchestrator
            ingest_plan = ingest_orchestrator.run_document_ingest_plan(
                filename=safe_filename,
                content_type=file.content_type,
                data=file_bytes,
            )
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail, "stage": "extract"},
            )
        except Exception as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": str(exc), "stage": "extract"},
            )

        raw_text = str(ingest_plan.get("raw_text", ""))
        layout = ingest_plan.get("layout")
        layout_payload = layout if isinstance(layout, dict) else None
        routing_trace = ingest_plan.get("routing_trace")
        if not isinstance(routing_trace, dict):
            routing_trace = {}

        raw_candidates = ingest_plan.get("candidates")
        if not isinstance(raw_candidates, list):
            return JSONResponse(
                status_code=422,
                content={"detail": "Extractor returned an invalid response.", "stage": "extract"},
            )
        candidates = [candidate for candidate in raw_candidates if isinstance(candidate, dict)]
        if not candidates:
            return JSONResponse(
                status_code=422,
                content={"detail": "Extractor returned no candidates.", "stage": "extract"},
            )

        try:
            arbiter_warnings: list[str] = []
            repair_warnings: list[str] = []
            rule_candidate = candidates[0]
            llama_output = routing_trace.get("llama_output")
            if llama_output is not None:
                extraction_validation = compare_extractions(rule_candidate, llama_output)
            else:
                extraction_validation = {"match_score": 100.0, "differences": []}

            if len(candidates) > 1:
                arbitrated_candidate, arbiter_warnings = arbitrate_parsed_invoice(candidates)
            else:
                arbitrated_candidate, arbiter_warnings = rule_candidate, []

            repaired_candidate, repair_warnings = repair_parsed_invoice(arbitrated_candidate)

            extraction_validation.update(
                {
                    "arbiter_warnings": arbiter_warnings,
                    "repair_warnings": repair_warnings,
                    "evidence": _normalized_evidence(repaired_candidate.get("evidence")),
                    "fallback_sources": [],
                    "gemini_fallback_used": False,
                    "routing_trace": routing_trace,
                }
            )
        except Exception as exc:
            extraction_validation = {
                "match_score": 0.0,
                "differences": [f"ingest_orchestration_error:{exc}"],
                "evidence": [],
                "fallback_sources": [],
                "gemini_fallback_used": False,
                "routing_trace": routing_trace,
            }
            repaired_candidate = candidates[0]
            arbitrated_candidate = candidates[0]

        try:
            parsed_payload, resolved_year, resolved_quarter, parse_warnings = (
                _build_parsed_invoice_request_from_extraction(
                    extraction=repaired_candidate,
                    importer_name=importer_name,
                    importer_eori=importer_eori,
                    reporting_year=reporting_year,
                    reporting_quarter=reporting_quarter,
                )
            )
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail, "stage": "extract"},
            )
        except Exception as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": str(exc), "stage": "extract"},
            )

        try:
            dq_precheck = _parsed_data_quality_precheck_from_payload(
                payload=parsed_payload,
                reporting_year=resolved_year,
                reporting_quarter=resolved_quarter,
            )
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail, "stage": "extract"},
            )
        except Exception as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": str(exc), "stage": "extract"},
            )

        extraction_validation["data_quality"] = dq_precheck

        match_score = extraction_validation.get("match_score", 0.0)
        try:
            match_score_value = float(match_score)
        except (TypeError, ValueError):
            match_score_value = 0.0
        dq_blocking = bool(dq_precheck.get("blocking", False))

        if (
            ENABLE_GEMINI_FALLBACK
            and match_score_value < GEMINI_MATCH_THRESHOLD
            and dq_blocking
        ):
            gemini_output = extract_structured_with_gemini(raw_text)
            if gemini_output:
                gemini_candidate = _llama_candidate_from_structured_invoice(
                    rule_candidate=rule_candidate if "rule_candidate" in locals() else candidates[0],
                    llama_output=gemini_output,
                    raw_text=raw_text,
                    layout_payload=layout_payload,
                )
                if gemini_candidate is not None:
                    gemini_candidate["source"] = "gemini"
                    if "candidates" in locals() and isinstance(candidates, list):
                        candidates.append(gemini_candidate)
                    else:
                        candidates = [dict(extraction), gemini_candidate]

                    extraction_validation["gemini_fallback_used"] = True
                    fallback_sources = extraction_validation.get("fallback_sources")
                    if not isinstance(fallback_sources, list):
                        fallback_sources = []
                    fallback_sources.append("gemini")
                    extraction_validation["fallback_sources"] = fallback_sources

                    if len(candidates) > 1:
                        arbitrated_candidate, arbiter_warnings = arbitrate_parsed_invoice(candidates)
                    else:
                        arbitrated_candidate, arbiter_warnings = candidates[0], []
                    repaired_candidate, repair_warnings = repair_parsed_invoice(arbitrated_candidate)

                    parsed_payload, resolved_year, resolved_quarter, parse_warnings = (
                        _build_parsed_invoice_request_from_extraction(
                            extraction=repaired_candidate,
                            importer_name=importer_name,
                            importer_eori=importer_eori,
                            reporting_year=reporting_year,
                            reporting_quarter=reporting_quarter,
                        )
                    )
                    dq_precheck = _parsed_data_quality_precheck_from_payload(
                        payload=parsed_payload,
                        reporting_year=resolved_year,
                        reporting_quarter=resolved_quarter,
                    )
                    extraction_validation["data_quality"] = dq_precheck
                    extraction_validation["arbiter_warnings"] = arbiter_warnings
                    extraction_validation["repair_warnings"] = repair_warnings
                    extraction_validation["evidence"] = _normalized_evidence(repaired_candidate.get("evidence"))

        try:
            created = _create_cbam_draft_from_parsed_invoice_payload(
                parsed_payload,
                reporting_year_override=resolved_year,
                reporting_quarter_override=resolved_quarter,
                warn_on_missing_emissions=True,
            )
        except Exception as exc:
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": str(exc), "stage": "draft"},
            )

        case_id_for_snapshot = str(created.get("case_id"))
        parent_hash: str | None = None
        extraction_stage_payload = {
            "raw_text": raw_text,
            "layout": layout_payload,
            "routing_trace": routing_trace,
            "candidates": candidates,
            "extraction_validation": {
                "match_score": extraction_validation.get("match_score"),
                "differences": extraction_validation.get("differences"),
                "fallback_sources": extraction_validation.get("fallback_sources"),
                "gemini_fallback_used": extraction_validation.get("gemini_fallback_used"),
            },
        }
        parent_hash = _safe_snapshot_write(
            case_id=case_id_for_snapshot,
            stage="extraction_v1",
            payload=extraction_stage_payload,
            parent_hash=parent_hash,
            algo_versions={"rule_extractor": "v1", "layout": "v1"},
            model_versions={
                "llama": str(os.getenv("LLAMA_STRUCTURED_MODEL", "unknown")),
                "gemini_enabled": bool(ENABLE_GEMINI_FALLBACK),
            },
        )
        parent_hash = _safe_snapshot_write(
            case_id=case_id_for_snapshot,
            stage="arbitrated_v1",
            payload=arbitrated_candidate,
            parent_hash=parent_hash,
            algo_versions={"arbiter": "v1"},
        )
        parent_hash = _safe_snapshot_write(
            case_id=case_id_for_snapshot,
            stage="repaired_v1",
            payload=repaired_candidate,
            parent_hash=parent_hash,
            algo_versions={"repair": "v1"},
        )

        repair_warns = extraction_validation.get("repair_warnings", [])
        arbiter_warns = extraction_validation.get("arbiter_warnings", [])
        dq_warns = []
        if isinstance(extraction_validation.get("data_quality"), dict):
            dq_data = extraction_validation["data_quality"]
            dq_warns.extend(f"dq_missing:{item}" for item in dq_data.get("missing", []))
            dq_warns.extend(f"dq_warning:{item}" for item in dq_data.get("warnings", []))

        merged_warnings = (
            parse_warnings
            + list(repair_warns if isinstance(repair_warns, list) else [])
            + list(arbiter_warns if isinstance(arbiter_warns, list) else [])
            + dq_warns
            + list(created.get("warnings", []))
        )
        return {
            "parsed": parsed_payload.model_dump(mode="json"),
            "created": created,
            "warnings": merged_warnings,
            "extraction_validation": extraction_validation,
        }
    finally:
        pass


@router.post("/shipments", status_code=status.HTTP_201_CREATED)
def create_cbam_shipment(payload: CBAMShipmentCreate):
    with engine.begin() as conn:
        _manual_fk_check(conn, "cbam_cases", payload.cbam_case_id, "cbam_case_id")
        columns = _table_columns(conn, "cbam_shipments")

        case_fk_column = _pick_existing(columns, ["cbam_case_id", "case_id"])
        if not case_fk_column:
            raise HTTPException(status_code=500, detail="No case FK column found on cbam_shipments.")

        insert_payload: dict[str, object] = {
            "id": str(uuid4()),
            case_fk_column: str(payload.cbam_case_id),
        }

        if "origin_country" in columns:
            insert_payload["origin_country"] = payload.origin_country

        if "customs_procedure" in columns:
            insert_payload["customs_procedure"] = payload.customs_procedure
        elif "incoterm" in columns:
            insert_payload["incoterm"] = payload.customs_procedure
        elif "entry_reference" in columns:
            insert_payload["entry_reference"] = payload.customs_procedure

        if _needs_explicit_value(columns, "import_date"):
            insert_payload["import_date"] = date.today()

        created = _insert_returning(conn, "cbam_shipments", insert_payload)
        return created


@router.post("/goods-lines", status_code=status.HTTP_201_CREATED)
def create_cbam_goods_line(payload: CBAMGoodsLineCreate):
    with engine.begin() as conn:
        _manual_fk_check(conn, "cbam_shipments", payload.shipment_id, "shipment_id")
        columns = _table_columns(conn, "cbam_goods_lines")

        insert_payload: dict[str, object] = {
            "id": str(uuid4()),
            "shipment_id": str(payload.shipment_id),
            "cn_code": payload.cn_code,
        }

        if "product_description" in columns:
            insert_payload["product_description"] = payload.product_description
        elif "description" in columns:
            insert_payload["description"] = payload.product_description

        if "net_mass_kg" in columns:
            insert_payload["net_mass_kg"] = payload.net_mass_kg
        elif "quantity" in columns:
            insert_payload["quantity"] = payload.net_mass_kg
            if "quantity_unit" in columns:
                insert_payload["quantity_unit"] = "kg"

        if _needs_explicit_value(columns, "sector"):
            insert_payload["sector"] = "iron_steel"

        created = _insert_returning(conn, "cbam_goods_lines", insert_payload)
        return created


@router.post("/emissions", status_code=status.HTTP_201_CREATED)
def create_cbam_emissions(payload: CBAMEmissionsCreate):
    try:
        with engine.begin() as conn:
            _manual_fk_check(conn, "cbam_goods_lines", payload.goods_line_id, "goods_line_id")
            columns = _table_columns(conn, "cbam_emissions")

            goods_line_fk_column = _pick_existing(columns, ["goods_line_id"])
            if not goods_line_fk_column:
                raise HTTPException(status_code=500, detail="No goods line FK column found on cbam_emissions.")

            direct_col = _pick_existing(columns, ["direct_emissions_kgco2e", "direct_embedded_kgco2e"])
            indirect_col = _pick_existing(columns, ["indirect_emissions_kgco2e", "indirect_embedded_kgco2e"])
            method_col = _pick_existing(columns, ["calculation_method", "method"])

            if not direct_col or not indirect_col or not method_col:
                raise HTTPException(status_code=500, detail="Expected emissions columns not found on cbam_emissions.")

            insert_payload: dict[str, object] = {
                "id": str(uuid4()),
                goods_line_fk_column: str(payload.goods_line_id),
                direct_col: payload.direct_emissions_kgco2e,
                indirect_col: payload.indirect_emissions_kgco2e,
                method_col: payload.calculation_method.value,
                "version": payload.version,
            }

            created = _insert_returning(conn, "cbam_emissions", insert_payload)
            return created
    except IntegrityError:
        allowed = ", ".join(ALLOWED_EMISSIONS_METHODS)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "invalid_emissions_method",
                "detail": f"method must be one of: {allowed}",
            },
        )


@router.get("/cases/{case_id}/summary")
def get_cbam_case_summary(case_id: UUID):
    with engine.begin() as conn:
        _manual_fk_check(conn, "cbam_cases", case_id, "case_id")
        case_row = conn.execute(
            text(
                """
                SELECT *
                FROM cbam.cbam_cases
                WHERE id = :id
                LIMIT 1
                """
            ),
            {"id": str(case_id)},
        ).mappings().one()
        shipments_payload = _build_case_shipments_payload(conn, case_id)
        summary = _build_case_summary(conn, case_id)
        summary["data_quality"] = evaluate_cbam_data_quality(dict(case_row), shipments_payload)
        return summary


@router.get("/cases/{case_id}/report-package")
def get_cbam_report_package(case_id: UUID):
    with engine.begin() as conn:
        case_rows = conn.execute(
            text(
                """
                SELECT *
                FROM cbam.cbam_cases
                WHERE id = :id
                LIMIT 1
                """
            ),
            {"id": str(case_id)},
        ).mappings().all()

        if not case_rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

        case_row = dict(case_rows[0])
        shipments_payload = _build_case_shipments_payload(conn, case_id)
        data_quality = evaluate_cbam_data_quality(case_row, shipments_payload)
        generated_at = datetime.now(timezone.utc).isoformat()
        report_package = {
            "type": "cbam_report_package_v1",
            "generated_at": generated_at,
            "case": case_row,
            "shipments": shipments_payload,
            "summary": _build_case_summary(conn, case_id),
            "data_quality": data_quality,
        }
        snapshot_hash: str | None = None
        parent_hash: str | None = None
        algo_versions: dict[str, object] = {"report_package_builder": "v1"}
        model_versions: dict[str, object] = {}

        try:
            snapshot = get_snapshot_store().append_snapshot(
                case_id=str(case_id),
                stage="report_package_v1",
                payload=report_package,
                algo_versions=algo_versions,
                model_versions=model_versions,
            )
            snapshot_hash = snapshot.payload_hash
            parent_hash = snapshot.parent_hash
            algo_versions = dict(snapshot.algo_versions)
            model_versions = dict(snapshot.model_versions)
        except Exception:
            pass

        report_package["audit"] = _report_package_audit_block(
            case_id=str(case_id),
            artifact_payload=report_package,
            generated_at=generated_at,
            snapshot_hash=snapshot_hash,
            parent_hash=parent_hash,
            algo_versions=algo_versions,
            model_versions=model_versions,
        )
        return report_package


@router.get("/cases/{case_id}/explain")
def get_cbam_case_explain(
    case_id: UUID,
    metric: str | None = Query(default=None),
    field: str | None = Query(default=None),
):
    if bool(metric) == bool(field):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide exactly one of metric or field.",
        )

    snapshot_store = get_snapshot_store()
    case_id_str = str(case_id)

    try:
        if metric:
            return explain_metric(
                store=snapshot_store,
                case_id=case_id_str,
                metric=metric,
            )
        return explain_field(
            store=snapshot_store,
            case_id=case_id_str,
            field_path=str(field),
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found") from exc
