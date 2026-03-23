from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import text

from . import _shared
from ledger_app.services.cbam_classifier import classify_description
from ledger_app.services.cbam_taric import is_in_cbam_scope, lookup_sector, CBAMCodeNotInScope
from shared_auth.dependencies import require_scopes

router = APIRouter()


class ClassifyRequest(BaseModel):
    description: str
    hint_cn_code: str | None = None
    llm_fallback: bool = True


class ReclassifyRequest(BaseModel):
    cn_code: str


@router.post("/classify")
def classify_cn_code(payload: ClassifyRequest, request: Request):
    """Classify a product description to a CBAM CN code.

    Requires a valid Bearer JWT (any scopes).  The classification pipeline runs:
      1. Literal CN code extraction from description text.
      2. hint_cn_code validation (if provided and in CBAM scope).
      3. Keyword / phrase table matching.
      4. Optional LLM fallback (Claude, requires ANTHROPIC_API_KEY).
    """
    # Ensure the caller is authenticated — raises 401 if token is absent/invalid.
    _auth = getattr(request.state, "auth_context", None)
    if _auth is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    result = classify_description(
        payload.description,
        hint_cn_code=payload.hint_cn_code,
        llm_fallback=payload.llm_fallback,
    )
    return {
        "cn_code": result.cn_code,
        "sector": result.sector,
        "confidence": float(result.confidence),
        "method": result.method,
        "requires_review": result.requires_review,
        "candidates": result.candidates,
        "review_reason": result.review_reason,
    }


@router.post("/cases/{case_id}/goods-lines/{line_id}/reclassify")
def reclassify_goods_line(
    case_id: UUID,
    line_id: UUID,
    payload: ReclassifyRequest,
    request: Request,
    _scopes: None = Depends(require_scopes(["cbam:write"])),
):
    """Manually reclassify a goods line with an authoritative CN code.

    Sets ``cn_classification_method="manual"``, ``cn_classification_confidence=1.0``,
    and ``cn_requires_review=False``.  The supplied CN code must be present in
    CBAM Annex I (EU 2023/956) — out-of-scope codes are rejected with HTTP 400.

    Requires JWT scope ``cbam:write``.
    """
    # Validate the supplied CN code is in CBAM Annex I scope.
    if not is_in_cbam_scope(payload.cn_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"CN code {payload.cn_code!r} is not in CBAM scope "
                "(EU 2023/956 Annex I). Only Annex I codes may be assigned."
            ),
        )

    sector = lookup_sector(payload.cn_code)
    if sector is None:
        # Defensive: is_in_cbam_scope passed but lookup_sector returned None.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to determine sector for CN code {payload.cn_code!r}.",
        )

    with _shared.engine.begin() as conn:
        # Verify the goods line exists and belongs to the given case.
        row = conn.execute(
            text(
                """
                SELECT gl.id, gl.shipment_id
                FROM cbam.cbam_goods_lines gl
                JOIN cbam.cbam_shipments s ON s.id = gl.shipment_id
                WHERE gl.id = :line_id
                  AND s.case_id = :case_id
                """
            ),
            {"line_id": str(line_id), "case_id": str(case_id)},
        ).mappings().first()

        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goods line not found for this case.",
            )

        conn.execute(
            text(
                """
                UPDATE cbam.cbam_goods_lines
                SET cn_code                     = :cn_code,
                    sector                      = :sector,
                    cn_classification_method    = 'manual',
                    cn_classification_confidence = 1.0,
                    cn_requires_review          = FALSE
                WHERE id = :line_id
                """
            ),
            {
                "cn_code": payload.cn_code,
                "sector": sector,
                "line_id": str(line_id),
            },
        )

    return {
        "goods_line_id": str(line_id),
        "cn_code": payload.cn_code,
        "sector": sector,
        "cn_classification_method": "manual",
        "cn_classification_confidence": 1.0,
        "cn_requires_review": False,
    }
