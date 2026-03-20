"""Supplier Emissions Data Request API — UK/EU CBAM.

Route prefix: /api/cbam  (registered in main.py with prefix="/api")

Endpoints
---------
POST /cbam/goods-lines/{goods_line_id}/generate-supplier-request
    Generate a pre-populated emissions data request letter for the installation
    operator named on a specific goods line.  Returns JSON (email) or a PDF
    download depending on the ``format`` query parameter.

POST /cbam/cases/{case_id}/generate-all-supplier-requests
    Generate request letters for every goods line in a CBAM case, deduplicated
    by (origin_country, installation_name).  Returns a ZIP archive.

Auth: Bearer JWT required (applied at router level in main.py).
      Mutations require the ``cbam:write`` scope.

Regulatory basis:
  EU 2023/1773, Annex IV — calculation methodology (embedded emissions)
  EU 2023/956            — CBAM scope (goods / sectors)
  Finance (No.2) Bill 2025-26 — UK CBAM framework
"""

from __future__ import annotations

import io
import logging
from dataclasses import asdict
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text

from app.services.supplier_templates import (
    GoodsLineContext,
    generate_batch_zip,
    generate_supplier_request,
    render_pdf_letter,
)
from ledger_app.api.cbam._shared import engine
from shared_auth.dependencies import require_scopes
from shared_auth.models import AuthContext

_log = logging.getLogger("nucleos.supplier_outreach")

router = APIRouter(prefix="/cbam", tags=["supplier-outreach"])


# ── Helpers ──────────────────────────────────────────────────────────────────────

def _resolved_tenant(request: Request) -> UUID:
    """Extract and validate the tenant UUID from the request auth context."""
    auth = getattr(request.state, "auth_context", None)
    tid = getattr(auth, "tenant_id", None) or ""
    if not tid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant ID is required.",
        )
    try:
        return UUID(tid)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tenant ID {tid!r} is not a valid UUID.",
        )


_GOODS_LINE_QUERY = text("""
    SELECT
        gl.id                   AS goods_line_id,
        gl.cn_code,
        gl.sector,
        gl.description,
        gl.installation_name,
        gl.installation_id,
        gl.quantity,
        gl.quantity_unit,
        sh.origin_country,
        sh.import_date,
        cc.importer_name,
        cc.importer_eori,
        cc.reporting_year,
        cc.tenant_id,
        em.production_route
    FROM   cbam.cbam_goods_lines gl
    JOIN   cbam.cbam_shipments    sh ON sh.id = gl.shipment_id
    JOIN   cbam.cbam_cases        cc ON cc.id = sh.case_id
    LEFT   JOIN LATERAL (
        SELECT production_route
        FROM   cbam.cbam_emissions
        WHERE  goods_line_id = gl.id
        ORDER  BY version DESC
        LIMIT  1
    ) em ON true
    WHERE  gl.id = :goods_line_id
""")

_CASE_GOODS_LINES_QUERY = text("""
    SELECT
        gl.id                   AS goods_line_id,
        gl.cn_code,
        gl.sector,
        gl.description,
        gl.installation_name,
        gl.installation_id,
        gl.quantity,
        gl.quantity_unit,
        sh.origin_country,
        sh.import_date,
        cc.importer_name,
        cc.importer_eori,
        cc.reporting_year,
        em.production_route
    FROM   cbam.cbam_goods_lines gl
    JOIN   cbam.cbam_shipments    sh ON sh.id = gl.shipment_id
    JOIN   cbam.cbam_cases        cc ON cc.id = sh.case_id
    LEFT   JOIN LATERAL (
        SELECT production_route
        FROM   cbam.cbam_emissions
        WHERE  goods_line_id = gl.id
        ORDER  BY version DESC
        LIMIT  1
    ) em ON true
    WHERE  sh.case_id = :case_id
      AND  cc.tenant_id = :tenant_id
    ORDER  BY sh.import_date, gl.cn_code
""")


def _row_to_ctx(row: dict) -> GoodsLineContext:
    """Map a DB result row to a GoodsLineContext dataclass."""
    qty = row.get("quantity")
    return GoodsLineContext(
        goods_line_id=str(row["goods_line_id"]),
        cn_code=row["cn_code"],
        sector=row["sector"],
        description=row.get("description"),
        installation_name=row.get("installation_name"),
        installation_id=row.get("installation_id"),
        origin_country=row.get("origin_country"),
        import_date=row.get("import_date"),
        quantity=Decimal(str(qty)) if qty is not None else None,
        quantity_unit=row.get("quantity_unit"),
        production_route=row.get("production_route"),
        importer_name=row.get("importer_name"),
        importer_eori=row.get("importer_eori"),
        reporting_year=int(row["reporting_year"]),
    )


def _supplier_request_to_dict(req) -> dict:
    """Serialise a SupplierRequest dataclass to a JSON-safe dict."""
    d = asdict(req)
    # Convert Decimal fields if any sneak through (none expected but guard anyway)
    if hasattr(d.get("quantity"), "__float__"):
        d["quantity"] = float(d["quantity"])
    # generated_at is a datetime — convert to ISO string
    if hasattr(d.get("generated_at"), "isoformat"):
        d["generated_at"] = d["generated_at"].isoformat()
    return d


# ── Request / response models ─────────────────────────────────────────────────────

class SingleRequestBody(BaseModel):
    """Body for the single-goods-line endpoint."""

    supplier_contact_name: str | None = None
    """Optional: personalise the letter salutation (e.g. "Mr. Huang Wei")."""

    jurisdiction: Literal["UK", "EU", "BOTH"] = "UK"
    """Jurisdiction determines which regulation references appear in the letter."""


# ── Endpoints ─────────────────────────────────────────────────────────────────────

@router.post(
    "/goods-lines/{goods_line_id}/generate-supplier-request",
    summary="Generate a supplier emissions data request",
    status_code=status.HTTP_200_OK,
)
def generate_single_supplier_request(
    goods_line_id: UUID,
    body: SingleRequestBody,
    request: Request,
    fmt: Literal["email", "pdf"] = Query(default="email", alias="format"),
    _auth: AuthContext = Depends(require_scopes(["cbam:read"])),
):
    """Generate a pre-populated CBAM supplier data request letter for one goods line.

    The letter names the exact CN code, required data fields with units and
    regulatory references, and flags when a translation is recommended.

    **`format=email`** (default) — returns a JSON object with:
    - `email_subject` — ready-to-use subject line
    - `email_text` — plain-text letter body (paste into your email client)
    - `translation_recommended` — whether a translated cover note is advisable
    - `translation_language_hint` — suggested language (e.g. "Chinese (Simplified)")
    - `data_fields_requested` — list of field IDs the supplier must provide
    - `regulation_refs` — regulatory basis statements

    **`format=pdf`** — returns an `application/pdf` download (A4 letterhead).
    """
    tenant_id = _resolved_tenant(request)

    with engine.connect() as conn:
        row = conn.execute(
            _GOODS_LINE_QUERY,
            {"goods_line_id": str(goods_line_id)},
        ).mappings().first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Goods line {goods_line_id!s} not found.",
        )

    # Tenant isolation — goods line must belong to the authenticated tenant
    if str(row.get("tenant_id", "")) != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Goods line {goods_line_id!s} not found.",
        )

    ctx = _row_to_ctx(dict(row))
    req = generate_supplier_request(
        ctx,
        jurisdiction=body.jurisdiction,
        supplier_contact_name=body.supplier_contact_name,
    )

    _log.info(
        "supplier_request_generated: tenant=%s goods_line=%s sector=%s fmt=%s",
        tenant_id, goods_line_id, ctx.sector, fmt,
    )

    if fmt == "pdf":
        pdf_bytes = render_pdf_letter(req)
        safe_cn = req.cn_code.replace("/", "_")
        filename = f"supplier_request_{safe_cn}_{req.reporting_year}.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(pdf_bytes)),
            },
        )

    # Default: email JSON
    return _supplier_request_to_dict(req)


@router.post(
    "/cases/{case_id}/generate-all-supplier-requests",
    summary="Generate supplier request letters for all goods lines in a case",
    status_code=status.HTTP_200_OK,
)
def generate_all_supplier_requests(
    case_id: UUID,
    request: Request,
    jurisdiction: Literal["UK", "EU", "BOTH"] = Query(default="UK"),
    include_pdf: bool = Query(
        default=True,
        description="Include a PDF letter alongside the plain-text email in the ZIP.",
    ),
    _auth: AuthContext = Depends(require_scopes(["cbam:read"])),
):
    """Generate supplier data request letters for all goods lines in a CBAM case.

    Returns a `application/zip` archive.  Each entry in the ZIP contains:
    - `{n}_{country}_{installation}_{cn_code}_email.txt` — plain-text letter
    - `{n}_{country}_{installation}_{cn_code}_letter.pdf` — PDF (if `include_pdf=true`)

    A `README.txt` manifest is included listing all letters with their key metadata.

    Goods lines are **deduplicated** by `(origin_country, installation_name)` so
    that a single installation receiving multiple CN codes gets one combined letter
    listing all required fields.

    If the case has no goods lines a 404 is returned.
    """
    tenant_id = _resolved_tenant(request)

    with engine.connect() as conn:
        rows = conn.execute(
            _CASE_GOODS_LINES_QUERY,
            {"case_id": str(case_id), "tenant_id": str(tenant_id)},
        ).mappings().all()

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Case {case_id!s} not found, does not belong to this tenant, "
                "or contains no goods lines."
            ),
        )

    # Deduplicate by (origin_country, installation_name) — one request per
    # unique installation.  When multiple goods lines share an installation,
    # the first row provides the letter context; all CN codes are visible in
    # the email body because each goods line produces its own SupplierRequest.
    seen: set[tuple[str | None, str | None]] = set()
    unique_rows = []
    for row in rows:
        key = (row.get("origin_country"), row.get("installation_name"))
        if key not in seen:
            seen.add(key)
            unique_rows.append(row)

    requests = [
        generate_supplier_request(
            _row_to_ctx(dict(row)),
            jurisdiction=jurisdiction,
        )
        for row in unique_rows
    ]

    zip_bytes = generate_batch_zip(requests, include_pdf=include_pdf)

    # Derive a safe case-ID slug for the filename
    case_slug = str(case_id).split("-")[0]
    filename = f"cbam_supplier_requests_{case_slug}.zip"

    _log.info(
        "supplier_batch_generated: tenant=%s case=%s letters=%d include_pdf=%s",
        tenant_id, case_id, len(requests), include_pdf,
    )

    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(zip_bytes)),
        },
    )
