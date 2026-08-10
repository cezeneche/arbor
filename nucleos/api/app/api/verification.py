"""Third-party verification workflow endpoints — UK CBAM.

Route prefix: /api/cbam  (registered in main.py with prefix="/api")

Endpoints
---------
POST /cbam/goods-lines/{id}/upload-verification
    Upload a PDF verification report from a GACI-accredited verifier.
    Sets verification_status → 'submitted'.

POST /cbam/goods-lines/{id}/request-verification
    Importer flags a goods line for verification engagement.
    Sets verification_status → 'pending'.

POST /cbam/goods-lines/{id}/verify
    Compliance reviewer accepts the verification report.
    Sets verification_status → 'verified'.  Requires cbam:write scope.

POST /cbam/goods-lines/{id}/reject-verification
    Compliance reviewer rejects the verification report.
    Sets verification_status → 'rejected'.  Requires cbam:write scope.

GET /cbam/cases/{id}/verification-status
    Dashboard: verification status summary for all goods lines in a case.
    Returns per-line status, method, blocking_submission flag, and summary counts.

Regulatory basis
----------------
Finance No.2 Bill 2025-26; HMRC CBAM Secondary Legislation February 2026.
Verifiers must be GACI-accredited to ISO 17029 / ISO 14064-3 / ISO 14065 /
ISO 14066.  Importers must retain verification reports for 6 years.

Auth: all endpoints require Bearer JWT (applied at router level in main.py).
Mutations require the ``cbam:write`` scope.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.services.report_validator import requires_verification
from ledger_app.api.cbam._shared import (
    _table_columns,
    engine,
    set_tenant_context,
)
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

_log = logging.getLogger("nucleos.verification")

router = APIRouter(prefix="/cbam", tags=["verification"])

# Allowed verification_status → next states (mirrors the DB function)
_TRANSITIONS: dict[str, frozenset[str]] = {
    "not_required": frozenset({"pending"}),
    "pending":      frozenset({"submitted", "not_required"}),
    "submitted":    frozenset({"verified", "rejected"}),
    "verified":     frozenset(),
    "rejected":     frozenset({"pending"}),
}


# ── Pydantic models ────────────────────────────────────────────────────────────

class RejectionRequest(BaseModel):
    reason: str = Field(
        ..., min_length=1, max_length=1000,
        description="Mandatory reason for rejection — communicated to the importer.",
    )


# ── Internal helpers ───────────────────────────────────────────────────────────

def _tenant_id(request: Request) -> str:
    return getattr(getattr(request.state, "auth_context", None), "tenant_id", "") or ""


def _require_write(
    auth: AuthContext = Depends(require_scopes(["cbam:write"])),
) -> AuthContext:
    return auth


def _fetch_goods_line_with_tenant_check(
    conn: Any,
    goods_line_id: str,
    tenant_id: str,
) -> dict[str, Any]:
    """Return the goods_line row after verifying it belongs to tenant_id.

    Traverses: cbam_goods_lines → cbam_shipments → cbam_cases.tenant_id.
    Raises 404 when not found or not owned by the tenant.
    """
    columns = _table_columns(conn, "cbam_cases")
    tenant_filter = (
        "AND c.tenant_id = :tenant_id" if "tenant_id" in columns else ""
    )
    rows = conn.execute(
        text(
            f"""
            SELECT gl.id,
                   gl.cn_code,
                   gl.sector,
                   gl.verification_status,
                   gl.verifier_name,
                   gl.verifier_accreditation,
                   gl.verification_report_path,
                   gl.verification_report_hash,
                   gl.verified_at,
                   s.case_id
            FROM   cbam.cbam_goods_lines gl
            JOIN   cbam.cbam_shipments   s ON gl.shipment_id = s.id
            JOIN   cbam.cbam_cases       c ON s.case_id = c.id
            WHERE  gl.id = :goods_line_id
            {tenant_filter}
            LIMIT  1
            """
        ),
        {"goods_line_id": goods_line_id, "tenant_id": tenant_id},
    ).mappings().all()

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Goods line {goods_line_id!r} not found or not accessible.",
        )
    return dict(rows[0])


def _transition_status(
    conn: Any,
    goods_line_id: str,
    tenant_id: str,
    from_status: str,
    to_status: str,
    extra_fields: dict[str, Any],
) -> dict[str, Any]:
    """Validate and apply a verification_status transition, returning the updated row."""
    if to_status not in _TRANSITIONS.get(from_status, frozenset()):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Invalid verification transition: {from_status!r} → {to_status!r}. "
                f"Allowed next states from {from_status!r}: "
                f"{sorted(_TRANSITIONS.get(from_status, frozenset()))}"
            ),
        )

    set_cols = ", ".join(f"{k} = :{k}" for k in extra_fields)
    params = {"goods_line_id": goods_line_id, **extra_fields}

    columns = _table_columns(conn, "cbam_cases")
    tenant_filter = ""
    if "tenant_id" in columns:
        tenant_filter = (
            "AND EXISTS ("
            "  SELECT 1 FROM cbam.cbam_shipments s "
            "  JOIN cbam.cbam_cases c ON s.case_id = c.id "
            "  WHERE s.id = gl.shipment_id AND c.tenant_id = :tenant_id"
            ")"
        )
        params["tenant_id"] = tenant_id

    set_clause = f"verification_status = :to_status{', ' + set_cols if set_cols else ''}"
    params["to_status"] = to_status

    result = conn.execute(
        text(
            f"""
            UPDATE cbam.cbam_goods_lines gl
            SET    {set_clause}
            WHERE  gl.id = :goods_line_id
            {tenant_filter}
            RETURNING gl.id, gl.cn_code, gl.verification_status,
                      gl.verifier_name, gl.verifier_accreditation,
                      gl.verification_report_path, gl.verification_report_hash,
                      gl.verified_at
            """
        ),
        params,
    )
    rows = result.mappings().all()
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Goods line {goods_line_id!r} not found or update rejected.",
        )
    return dict(rows[0])


def _try_write_audit(case_id: str, event_type: str, payload: dict) -> None:
    try:
        from ledger_app.api.cbam._shared import _write_audit_event
        _write_audit_event(case_id, event_type, payload, actor_sub="verification-workflow")
    except Exception as exc:
        _log.debug("audit log write for %s failed (non-fatal): %s", event_type, exc)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/goods-lines/{goods_line_id}/request-verification",
    status_code=status.HTTP_200_OK,
)
def request_verification(
    request: Request,
    goods_line_id: str,
    auth: AuthContext = Depends(_require_write),
):
    """Flag a goods line for verifier engagement (not_required → pending).

    The importer calls this once they have engaged a GACI-accredited verifier
    and are awaiting the signed report.  Only goods lines with
    calculation_method='actual' require verification.
    """
    tenant_id = _tenant_id(request)

    with engine.begin() as conn:
        gl = _fetch_goods_line_with_tenant_check(conn, goods_line_id, tenant_id)
        current = gl["verification_status"]

        updated = _transition_status(
            conn, goods_line_id, tenant_id,
            from_status=current,
            to_status="pending",
            extra_fields={},
        )

    _try_write_audit(
        str(gl.get("case_id", "")),
        "verification_requested",
        {"goods_line_id": goods_line_id, "cn_code": gl.get("cn_code"), "from_status": current},
    )

    return {
        "goods_line_id": goods_line_id,
        "verification_status": updated["verification_status"],
        "message": (
            "Verification status set to 'pending'. Upload the verifier's signed "
            "PDF report via POST /api/cbam/goods-lines/{id}/upload-verification."
        ),
    }


@router.post(
    "/goods-lines/{goods_line_id}/upload-verification",
    status_code=status.HTTP_200_OK,
)
async def upload_verification_report(
    request: Request,
    goods_line_id: str,
    verifier_name: str = Form(..., description="Name of the GACI-accredited verifier organisation."),
    verifier_accreditation: str = Form(
        ...,
        description=(
            "Accreditation body and reference (e.g. 'UKAS ref 9876'). "
            "Must be ISO 17029 / ISO 14064-3 / ISO 14065 / ISO 14066 accredited."
        ),
    ),
    file: UploadFile = File(..., description="PDF verification report from the accredited verifier."),
    auth: AuthContext = Depends(_require_write),
):
    """Upload the verifier's signed PDF report (pending → submitted).

    Storage path: ``{tenant_id}/verification/{goods_line_id}/report_{timestamp}.pdf``

    Records the SHA-256 hash of the document for tamper detection.
    A compliance reviewer must subsequently call POST .../verify or
    .../reject-verification to complete the workflow.

    Accepted content type: ``application/pdf``.
    Requires scope: ``cbam:write``.
    """
    tenant_id = _tenant_id(request)

    content_type = (file.content_type or "").lower()
    if content_type not in ("application/pdf", "application/octet-stream", ""):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"Verification reports must be PDF files (received: {content_type!r}). "
                "Only PDF documents from ISO-accredited verifiers are accepted."
            ),
        )

    data = await file.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    sha256_hex = hashlib.sha256(data).hexdigest()
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    storage_path = f"{tenant_id}/verification/{goods_line_id}/report_{ts}.pdf"
    storage_uri: str | None = None

    # Upload to Supabase Storage
    try:
        from ledger_app.services.storage import upload_document_async

        result = await upload_document_async(
            tenant_id=tenant_id,
            document_id=f"verification/{goods_line_id}",
            filename=f"report_{ts}.pdf",
            data=data,
        )
        storage_path = result.storage_path
        storage_uri  = result.storage_uri
        _log.info(
            "Verification report uploaded: goods_line=%s path=%s sha256=%s size=%d",
            goods_line_id, storage_path, sha256_hex, len(data),
        )
    except Exception as exc:
        _log.warning(
            "Supabase Storage upload failed (non-fatal — hash still recorded): %s", exc
        )

    with engine.begin() as conn:
        gl = _fetch_goods_line_with_tenant_check(conn, goods_line_id, tenant_id)
        current = gl["verification_status"]

        # Allow upload from 'pending' or 're-upload' from 'rejected'
        if current not in ("pending", "rejected", "submitted"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Cannot upload a verification report when "
                    f"verification_status={current!r}. "
                    "Call POST .../request-verification first to set status to 'pending'."
                ),
            )

        updated = _transition_status(
            conn, goods_line_id, tenant_id,
            from_status=current,
            to_status="submitted",
            extra_fields={
                "verifier_name":           verifier_name,
                "verifier_accreditation":  verifier_accreditation,
                "verification_report_path": storage_path,
                "verification_report_hash": sha256_hex,
            },
        )

    _try_write_audit(
        str(gl.get("case_id", "")),
        "verification_submitted",
        {
            "goods_line_id":          goods_line_id,
            "cn_code":                gl.get("cn_code"),
            "verifier_name":          verifier_name,
            "verifier_accreditation": verifier_accreditation,
            "storage_path":           storage_path,
            "sha256":                 sha256_hex,
            "file_size_bytes":        len(data),
        },
    )

    return {
        "goods_line_id":              goods_line_id,
        "verification_status":        updated["verification_status"],
        "verifier_name":              updated.get("verifier_name"),
        "verifier_accreditation":     updated.get("verifier_accreditation"),
        "verification_report_path":   updated.get("verification_report_path"),
        "verification_report_hash":   updated.get("verification_report_hash"),
        "storage_uri":                storage_uri,
        "file_size_bytes":            len(data),
        "message": (
            "Verification report uploaded and status set to 'submitted'. "
            "A compliance reviewer must approve via POST "
            "/api/cbam/goods-lines/{id}/verify before 'actual_verified' "
            "status can be claimed in the HMRC return."
        ),
    }


@router.post(
    "/goods-lines/{goods_line_id}/verify",
    status_code=status.HTTP_200_OK,
)
def approve_verification(
    request: Request,
    goods_line_id: str,
    auth: AuthContext = Depends(_require_write),
):
    """Compliance reviewer accepts the verification report (submitted → verified).

    Once verified, the goods line may claim 'actual_verified' status in the
    HMRC return.  This transition is irreversible.

    Requires scope: ``cbam:write``.
    """
    tenant_id = _tenant_id(request)
    now_ts = datetime.now(timezone.utc).isoformat()

    with engine.begin() as conn:
        gl = _fetch_goods_line_with_tenant_check(conn, goods_line_id, tenant_id)
        current = gl["verification_status"]

        updated = _transition_status(
            conn, goods_line_id, tenant_id,
            from_status=current,
            to_status="verified",
            extra_fields={"verified_at": now_ts},
        )

    _try_write_audit(
        str(gl.get("case_id", "")),
        "verification_approved",
        {
            "goods_line_id": goods_line_id,
            "cn_code":       gl.get("cn_code"),
            "reviewer_sub":  auth.sub if auth else None,
            "verified_at":   now_ts,
        },
    )

    return {
        "goods_line_id":       goods_line_id,
        "verification_status": updated["verification_status"],
        "verified_at":         updated.get("verified_at"),
        "message": (
            "Verification approved. This goods line may now claim "
            "'actual_verified' status in the HMRC return."
        ),
    }


@router.post(
    "/goods-lines/{goods_line_id}/reject-verification",
    status_code=status.HTTP_200_OK,
)
def reject_verification(
    request: Request,
    goods_line_id: str,
    payload: RejectionRequest,
    auth: AuthContext = Depends(_require_write),
):
    """Compliance reviewer rejects the verification report (submitted → rejected).

    The importer must engage a new GACI-accredited verifier and re-submit.
    The goods line will use 'actual_unverified' in the HMRC return until a
    new report is accepted.

    Requires scope: ``cbam:write``.
    """
    tenant_id = _tenant_id(request)

    with engine.begin() as conn:
        gl = _fetch_goods_line_with_tenant_check(conn, goods_line_id, tenant_id)
        current = gl["verification_status"]

        updated = _transition_status(
            conn, goods_line_id, tenant_id,
            from_status=current,
            to_status="rejected",
            extra_fields={},
        )

    _try_write_audit(
        str(gl.get("case_id", "")),
        "verification_rejected",
        {
            "goods_line_id": goods_line_id,
            "cn_code":       gl.get("cn_code"),
            "reviewer_sub":  auth.sub if auth else None,
            "reason":        payload.reason,
        },
    )

    return {
        "goods_line_id":       goods_line_id,
        "verification_status": updated["verification_status"],
        "rejection_reason":    payload.reason,
        "message": (
            "Verification report rejected. The importer must engage a new "
            "GACI-accredited verifier. Call POST .../request-verification "
            "to restart the workflow."
        ),
    }


@router.get("/cases/{case_id}/verification-status")
def case_verification_status(
    request: Request,
    case_id: str,
):
    """Verification status dashboard for all goods lines in a case.

    Returns a per-line breakdown with:
    - ``requires_verification``  — True when calculation_method='actual'
    - ``verification_status``    — current workflow state
    - ``blocking_submission``    — True when actual-method line is not yet verified;
                                   the HMRC return will downgrade this to
                                   'actual_unverified' if submitted now

    Also returns summary counts by status and total ``blocking_submission`` count.

    A ``blocking_submission`` flag does NOT prevent return production — it
    signals that the importer should seek verification to maximise accuracy
    and CPR claim eligibility.
    """
    tenant_id = _tenant_id(request)

    with engine.begin() as conn:
        # Tenant-filter the case
        case_columns = _table_columns(conn, "cbam_cases")
        tenant_filter = (
            "AND c.tenant_id = :tenant_id" if "tenant_id" in case_columns else ""
        )
        case_rows = conn.execute(
            text(
                f"""
                SELECT c.id, c.importer_eori, c.reporting_year, c.reporting_quarter
                FROM   cbam.cbam_cases c
                WHERE  c.id = :case_id
                {tenant_filter}
                LIMIT  1
                """
            ),
            {"case_id": case_id, "tenant_id": tenant_id},
        ).mappings().all()

        if not case_rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Case {case_id!r} not found or not accessible.",
            )

        case_row = dict(case_rows[0])

        # Fetch all goods lines for the case with their latest emission method
        # and verification status, using DISTINCT ON for the latest emission version.
        gl_rows = conn.execute(
            text(
                """
                WITH latest_em AS (
                    SELECT DISTINCT ON (goods_line_id)
                           goods_line_id,
                           method,
                           version
                    FROM   cbam.cbam_emissions
                    ORDER  BY goods_line_id, version DESC
                )
                SELECT
                    gl.id                       AS goods_line_id,
                    gl.cn_code,
                    gl.sector,
                    gl.verification_status,
                    gl.verifier_name,
                    gl.verifier_accreditation,
                    gl.verification_report_hash,
                    gl.verified_at,
                    s.id                        AS shipment_id,
                    s.origin_country,
                    s.import_date,
                    em.method                   AS calculation_method
                FROM   cbam.cbam_goods_lines gl
                JOIN   cbam.cbam_shipments   s  ON gl.shipment_id = s.id
                LEFT   JOIN latest_em            em ON em.goods_line_id = gl.id
                WHERE  s.case_id = :case_id
                ORDER  BY s.import_date, gl.cn_code
                """
            ),
            {"case_id": case_id},
        ).mappings().all()

    # Build per-line response with blocking flags
    goods_lines: list[dict[str, Any]] = []
    status_counts: dict[str, int] = {
        "not_required": 0,
        "pending":      0,
        "submitted":    0,
        "verified":     0,
        "rejected":     0,
    }
    total_requires_verification = 0
    total_blocking = 0

    for row in gl_rows:
        r = dict(row)
        gl_dict  = {"calculation_method": r.get("calculation_method")}
        em_dict  = {"method": r.get("calculation_method")}
        needs_v  = requires_verification(gl_dict, em_dict)
        vstatus  = str(r.get("verification_status") or "not_required")
        blocking = needs_v and vstatus != "verified"

        if needs_v:
            total_requires_verification += 1
        if blocking:
            total_blocking += 1

        status_counts[vstatus] = status_counts.get(vstatus, 0) + 1

        guidance: str | None = None
        if blocking:
            if vstatus == "not_required":
                guidance = (
                    "Call POST .../request-verification to begin the verification "
                    "workflow, then upload the verifier's report."
                )
            elif vstatus == "pending":
                guidance = (
                    "Verifier engagement in progress. Upload the signed PDF via "
                    "POST .../upload-verification once received."
                )
            elif vstatus == "submitted":
                guidance = (
                    "Report submitted and awaiting compliance review. "
                    "A reviewer must approve via POST .../verify."
                )
            elif vstatus == "rejected":
                guidance = (
                    "Verification report rejected. Engage a new GACI-accredited "
                    "verifier and re-submit."
                )

        goods_lines.append({
            "goods_line_id":          str(r.get("goods_line_id") or ""),
            "cn_code":                r.get("cn_code"),
            "sector":                 r.get("sector"),
            "shipment_id":            str(r.get("shipment_id") or ""),
            "origin_country":         r.get("origin_country"),
            "import_date":            str(r.get("import_date") or ""),
            "calculation_method":     r.get("calculation_method"),
            "requires_verification":  needs_v,
            "verification_status":    vstatus,
            "verifier_name":          r.get("verifier_name"),
            "verifier_accreditation": r.get("verifier_accreditation"),
            "verification_report_hash": r.get("verification_report_hash"),
            "verified_at":            str(r.get("verified_at") or "") or None,
            "blocking_submission":    blocking,
            "guidance":               guidance,
        })

    return {
        "case_id":          case_id,
        "reporting_period": (
            f"{case_row.get('reporting_year')}Q{case_row.get('reporting_quarter')}"
            if case_row.get("reporting_year") and case_row.get("reporting_quarter")
            else None
        ),
        "summary": {
            "total_goods_lines":         len(goods_lines),
            "requires_verification":     total_requires_verification,
            "by_status":                 status_counts,
            "blocking_submission":       total_blocking,
            "submission_ready":          total_blocking == 0,
        },
        "goods_lines": goods_lines,
    }
