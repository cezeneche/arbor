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

from ledger_app.core.crypto import decrypt_field, encrypt_field
from ledger_app.db.rls import set_tenant_context
from ledger_app.db.session import engine
from ledger_app.schemas.evidence import EvidenceAtom
from ledger_app.services.cbam_arbiter import arbitrate_parsed_invoice
from ledger_app.services.cbam_data_quality import evaluate_cbam_data_quality
from ledger_app.services.cbam_explain import explain_field
from ledger_app.services.cbam_explain import explain_metric
from ledger_app.services.cbam_repair import repair_parsed_invoice
from ledger_app.services.document_text_extractor import extract_document_from_upload
from ledger_app.services.cbam_extractor import extract as extract_cbam_document
from ledger_app.services.cbam_emission_factors import compute_see_from_defaults, validate_against_defaults
from ledger_app.services.cbam_calculation_service import compute_cbam_liability
from ledger_app.services.cbam_carbon_pricing import (
    get_all_recognised_schemes,
    lookup_carbon_pricing_scheme,
)
from ledger_app.services.cbam_installation_registry import validate_installation_id
from ledger_app.services.cbam_scope import ScopeStatus, determine_cbam_scope
from ledger_app.services.cbam_taric import CBAMCodeNotInScope, lookup_sector
from ledger_app.services.gemini_structured_extractor import extract_structured_with_gemini
from ledger_app.services.llama_structured_extractor import compare_extractions
from ledger_app.services.llama_orchestrator import LlamaOrchestrator
from ledger_app.services.orchestration import llama_orchestrator as ingest_orchestrator
from ledger_app.services.snapshot_store import bytes_sha256_hex
from ledger_app.services.snapshot_store import canonical_json
from ledger_app.services.snapshot_store import get_snapshot_store
from ledger_app.services.snapshot_store import sha256_hex

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
    # Per-tonne carbon price (EUR/tCO2e) paid in the origin country under a
    # recognised third-country scheme (EU 2023/956, Art. 9 deduction).
    # NULL when no scheme applies or not yet assessed.
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
    # Optional: supply for iron/steel, aluminium, or hydrogen to select the
    # correct Annex VI default value (e.g. "BF_BOF", "EAF", "primary", "SMR").
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
    # UK HMRC consignment fields (migration 008)
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


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def _table_columns(conn: Connection, table_name: str) -> dict[str, dict[str, str | None]]:
    # SQLite: use PRAGMA table_info — information_schema is not available.
    # getattr is used so that FakeConnection (test mock, no dialect attr) falls
    # through to the information_schema path it already intercepts.
    _dialect_name = getattr(getattr(conn, "dialect", None), "name", None)
    if _dialect_name == "sqlite":
        rows = conn.execute(
            text(f"PRAGMA table_info({table_name})")  # noqa: S608
        ).mappings().all()
        if not rows:
            raise HTTPException(status_code=500, detail="Internal server error")
        return {
            row["name"]: {
                "is_nullable": "NO" if row["notnull"] else "YES",
                "column_default": row["dflt_value"],
            }
            for row in rows
        }

    # PostgreSQL (production / Supabase)
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
        raise HTTPException(status_code=500, detail="Internal server error")

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


_ALLOWED_CBAM_TABLES: frozenset[str] = frozenset(
    {"cbam_cases", "cbam_shipments", "cbam_goods_lines", "cbam_emissions"}
)


def _manual_fk_check(conn: Connection, table_name: str, record_id: UUID, label: str) -> None:
    if table_name not in _ALLOWED_CBAM_TABLES:
        raise ValueError(f"Disallowed table reference: {table_name!r}")
    exists = conn.execute(
        text(f"SELECT 1 FROM cbam.{table_name} WHERE id = :id LIMIT 1"),
        {"id": str(record_id)},
    ).scalar_one_or_none()
    if exists is None:
        raise _bad_request(f"Invalid reference: {label} does not exist.")


def _enforce_tenant_id(columns: dict, tenant_id: str) -> None:
    """Raise 401 if the schema has a tenant_id column but no tenant is authenticated.

    This prevents a token with an empty tenant_id from matching all legacy rows
    (which have DEFAULT '').  In tests, FakeConnection never includes tenant_id
    in its column list, so this check is never triggered there.
    """
    if "tenant_id" in columns and not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing tenant context",
        )


def _require_case_tenant(conn: Connection, case_id: UUID | str, tenant_id: str) -> None:
    """Raise 404 if case_id does not exist or does not belong to the authenticated tenant.

    No-op when:
    - ``tenant_id`` is empty (unauthenticated / legacy / test contexts)
    - the ``cbam_cases`` schema has no ``tenant_id`` column yet

    Used by sub-resource write endpoints (documents, shipments, goods-lines,
    emissions) to verify case ownership before allowing mutations.
    """
    if not tenant_id:
        return
    columns = _table_columns(conn, "cbam_cases")
    if "tenant_id" not in columns:
        return
    exists = conn.execute(
        text(
            "SELECT 1 FROM cbam.cbam_cases WHERE id = :id AND tenant_id = :tid LIMIT 1"
        ),
        {"id": str(case_id), "tenant_id": tenant_id},
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


def _resolve_case_for_shipment(conn: Connection, shipment_id: UUID | str) -> str | None:
    """Return the cbam_cases.id for a given shipment (traverses FK to parent case)."""
    cols = _table_columns(conn, "cbam_shipments")
    case_col = _pick_existing(cols, ["cbam_case_id", "case_id"])
    if not case_col:
        return None
    row = conn.execute(
        text(
            f"SELECT {case_col} AS case_id FROM cbam.cbam_shipments WHERE id = :id LIMIT 1"
        ),
        {"id": str(shipment_id)},
    ).mappings().one_or_none()
    return str(row["case_id"]) if row else None


def _resolve_case_for_goods_line(conn: Connection, goods_line_id: UUID | str) -> str | None:
    """Return the cbam_cases.id for a given goods line (traverses goods_line → shipment → case)."""
    cols = _table_columns(conn, "cbam_shipments")
    case_col = _pick_existing(cols, ["cbam_case_id", "case_id"])
    if not case_col:
        return None
    row = conn.execute(
        text(
            f"""
            SELECT s.{case_col} AS case_id
            FROM cbam.cbam_goods_lines gl
            JOIN cbam.cbam_shipments s ON gl.shipment_id = s.id
            WHERE gl.id = :id
            LIMIT 1
            """
        ),
        {"id": str(goods_line_id)},
    ).mappings().one_or_none()
    return str(row["case_id"]) if row else None


def _quarter_from_date(value: date) -> int:
    return ((value.month - 1) // 3) + 1


def _infer_sector_from_cn_code(cn_code: str) -> str:
    """Return the CBAM sector for a CN code using the authoritative TARIC lookup.

    Source: EU Regulation 2023/956, Annex I (OJ L 130, 16.5.2023).
    Raises CBAMCodeNotInScope if the CN code is not covered by CBAM Annex I.
    """
    sector = lookup_sector(cn_code)
    if sector is None:
        raise CBAMCodeNotInScope(cn_code)
    return sector


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


def _write_audit_event(
    case_id: str,
    event_type: str,
    event_data: dict[str, object],
    actor_sub: str = "system",
) -> None:
    """
    Write a signed audit_log event for CBAM pipeline stages.

    Silently no-ops if the audit_log table doesn't exist (e.g., older SQLite test DB).
    """
    try:
        from ledger_app.services.audit_signer import get_prev_chain_hmac, sign_event

        event_json = json.dumps(event_data, sort_keys=True, default=str)
        with engine.begin() as conn:
            prev_hmac = get_prev_chain_hmac(case_id, conn)
            sig = sign_event(case_id, event_type, actor_sub, event_json,
                             prev_hmac=prev_hmac)
            conn.execute(
                text("""
                    INSERT INTO cbam.audit_log
                        (case_id, event_type, actor,
                         payload, signature, chain_hash)
                    VALUES
                        (:case_id, :event_type, :actor,
                         CAST(:event_json AS jsonb), :sig, :prev_hmac)
                """),
                {
                    "case_id": case_id,
                    "event_type": event_type,
                    "actor": actor_sub,
                    "event_json": event_json,
                    "sig": sig,
                    "prev_hmac": prev_hmac,
                },
            )
    except Exception:
        # Audit write must never break the caller.
        pass

    # Slack notification — separate try/except so it fires even when the DB
    # write is skipped (e.g., missing table in older test DBs) and never
    # blocks the caller regardless of network state.
    try:
        from ledger_app.services.slack_notifier import notify as _slack_notify

        _slack_notify(case_id, event_type, event_data)
    except Exception:
        pass


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
    """Return the SHA-256 of the source document for this case.

    Prefers the ``document_sha256`` field written at upload time (hash of the
    raw binary file bytes).  Falls back to ``sha256_hex(raw_text)`` for
    snapshots created before task #9 was implemented.
    """
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

    # Prefer the raw-bytes hash written at upload time (task #9).
    doc_sha256 = payload.get("document_sha256")
    if isinstance(doc_sha256, str) and doc_sha256:
        return doc_sha256

    # Legacy fallback: derive from extracted text.
    raw_text = payload.get("raw_text")
    if not isinstance(raw_text, str) or not raw_text:
        return None
    return sha256_hex(raw_text)


def _evidence_documents_from_snapshot(case_id: str) -> list[dict[str, object]]:
    """
    Build the evidence_documents list for the report package audit block.

    Returns a list of dicts, one per ingested source document, containing:
      - document_sha256: SHA-256 of the raw upload bytes (the immutable chain root)
      - filename: original filename if captured
      - ingested_at: ISO timestamp from the snapshot
      - snapshot_stage: e.g. "extraction_v1"
      - snapshot_hash: hash of the extraction snapshot payload

    Consumed by a third-party reviewer to verify source integrity without
    access to the platform database.
    """
    try:
        snapshot = get_snapshot_store().latest_snapshot_by_stage(case_id, "extraction_v1")
    except Exception:
        return []
    if snapshot is None:
        return []

    try:
        payload = json.loads(snapshot.payload_json)
    except Exception:
        return []
    if not isinstance(payload, dict):
        return []

    doc_sha256 = payload.get("document_sha256")
    if not doc_sha256:
        raw_text = payload.get("raw_text")
        doc_sha256 = sha256_hex(raw_text) if isinstance(raw_text, str) and raw_text else None

    return [
        {
            "document_sha256": doc_sha256,
            "filename": payload.get("filename"),
            "ingested_at": snapshot.created_at if hasattr(snapshot, "created_at") and snapshot.created_at else None,
            "snapshot_stage": "extraction_v1",
            "snapshot_hash": snapshot.payload_hash,
        }
    ]


def _extraction_evidence_summary(case_id: str) -> dict[str, object]:
    """
    Build the extraction_evidence block for the report package.

    Reads the arbitrated_v1 snapshot and returns:
      - snapshot_stage / snapshot_hash: chain reference
      - arbitrated_invoice_fields: the resolved invoice header values
      - goods_lines_count: how many line items were extracted
      - evidence_atoms: per-field evidence atoms (page, span, bbox, confidence, snippet)
        so a third-party auditor can locate every value in the source document.

    Returns an empty dict (not an error) when no arbitrated snapshot exists yet.
    """
    try:
        snapshot = get_snapshot_store().latest_snapshot_by_stage(case_id, "arbitrated_v1")
    except Exception:
        return {}
    if snapshot is None:
        return {}

    try:
        payload = json.loads(snapshot.payload_json)
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}

    invoice = payload.get("invoice") or {}
    lines = payload.get("lines") or []
    raw_atoms = payload.get("evidence") or []

    # Normalise evidence atoms — keep only serialisable scalar/list fields
    atoms_out: list[dict[str, object]] = []
    for atom in raw_atoms:
        if not isinstance(atom, dict):
            continue
        clean: dict[str, object] = {
            "field": atom.get("field"),
            "value": atom.get("value"),
            "source": atom.get("source"),
        }
        if atom.get("page") is not None:
            clean["page"] = atom["page"]
        if atom.get("span") is not None:
            clean["span"] = atom["span"]
        if atom.get("bbox") is not None:
            clean["bbox"] = atom["bbox"]
        if atom.get("confidence") is not None:
            clean["confidence"] = atom["confidence"]
        if atom.get("snippet") is not None:
            clean["snippet"] = atom["snippet"]
        atoms_out.append(clean)

    return {
        "snapshot_stage": "arbitrated_v1",
        "snapshot_hash": snapshot.payload_hash,
        "arbitrated_invoice_fields": {
            "invoice_number": invoice.get("invoice_number"),
            "invoice_date": invoice.get("invoice_date"),
            "origin_country": invoice.get("origin_country"),
            "incoterm": invoice.get("incoterm"),
        },
        "goods_lines_count": len(lines),
        "evidence_atoms": atoms_out,
    }


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
    from ledger_app.core.version import APP_GIT_SHA, APP_VERSION

    evidence_docs = _evidence_documents_from_snapshot(case_id)
    # Primary document_sha256: first doc in list for backward compat
    primary_sha256 = evidence_docs[0]["document_sha256"] if evidence_docs else _document_sha256_from_extraction_snapshot(case_id)
    merged_algo = dict(algo_versions or {})
    merged_algo.setdefault("app_git_sha", APP_GIT_SHA)
    merged_algo.setdefault("app_version", APP_VERSION)
    return {
        "document_sha256": primary_sha256,
        "evidence_documents": evidence_docs,
        "payload_hash": sha256_hex(canonical_json(artifact_payload)),
        "snapshot_hash": snapshot_hash,
        "parent_hash": parent_hash,
        "algo_versions": merged_algo,
        "model_versions": model_versions or {},
        "generated_at": generated_at,
    }


def _build_parsed_invoice_request_from_extraction(
    extraction: dict[str, object],
    importer_name: str | None,
    importer_eori: str | None,
    reporting_year: int | None,
    reporting_quarter: int | None,
    consignment_reference: str | None = None,
    customs_procedure_code: str | None = None,
    net_weight_kg: Decimal | None = None,
    is_temporary_admission: bool = False,
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
        # EORI not found in document — flag for completion before HMRC submission
        # rather than rejecting the upload entirely (DQ precheck will mark as blocking)
        parsed_importer_eori = ""
        warnings.append("importer_eori_missing:flag_for_human_completion_before_hmrc_submission")

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

    # consignment_reference: caller-supplied value takes priority over anything
    # extracted from the document (the form field is the authoritative source).
    # If neither is present, leave None — the draft will be flagged for human
    # completion before HMRC submission.
    resolved_consignment_ref = consignment_reference or (
        invoice_data.get("consignment_reference") if isinstance(invoice_data, dict) else None
    )
    if resolved_consignment_ref is None:
        warnings.append(
            "consignment_reference_missing:flag_for_human_completion_before_hmrc_submission"
        )

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
            "consignment_reference": resolved_consignment_ref,
            "customs_procedure_code": customs_procedure_code,
            "net_weight_kg": net_weight_kg,
            "is_temporary_admission": is_temporary_admission,
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
        raise HTTPException(status_code=500, detail="Internal server error")

    net_mass_col = _pick_existing(goods_cols, ["net_mass_kg", "quantity"])
    if not net_mass_col:
        raise HTTPException(status_code=500, detail="Internal server error")

    direct_col = _pick_existing(emissions_cols, ["direct_kgco2e", "direct_emissions_kgco2e", "direct_embedded_kgco2e"])
    indirect_col = _pick_existing(emissions_cols, ["indirect_kgco2e", "indirect_emissions_kgco2e", "indirect_embedded_kgco2e"])
    if not direct_col or not indirect_col:
        raise HTTPException(status_code=500, detail="Internal server error")

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
        raise HTTPException(status_code=500, detail="Internal server error")

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
            if latest_emissions is not None:
                # Normalize Supabase short column names to canonical keys used
                # throughout compliance_pack, eu_xml_builder, and report_validator.
                # cbam_emissions stores direct_kgco2e / indirect_kgco2e;
                # downstream code expects direct_embedded_kgco2e / indirect_embedded_kgco2e.
                if "direct_kgco2e" in latest_emissions and "direct_embedded_kgco2e" not in latest_emissions:
                    latest_emissions["direct_embedded_kgco2e"] = latest_emissions["direct_kgco2e"]
                if "indirect_kgco2e" in latest_emissions and "indirect_embedded_kgco2e" not in latest_emissions:
                    latest_emissions["indirect_embedded_kgco2e"] = latest_emissions["indirect_kgco2e"]
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
