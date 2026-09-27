"""CBAM supplier emissions history.

GET  /cbam/suppliers/{supplier_eori}/see-history
    Rolling per-CN-code SEE history for a supplier: the values the B2
    deviation check compares against.

The quarterly reconciliation route that shared this module was removed on 27
September 2026 (docs/audits/2026-09-27-nucleos-endpoints.md). The reconciler
itself lives in ledger_app.services.cbam_reconciler.

Scopes required: ``cbam:read``
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Query

from ledger_app.api.cbam._shared import engine
from sqlalchemy import text

router = APIRouter(tags=["cbam-reconcile"])

_D = Decimal


# helpers


# Endpoints

@router.get("/suppliers/{supplier_eori}/see-history")
async def get_supplier_see_history(
    request,
    supplier_eori: str,
    cn_code: str | None = Query(default=None, description="Filter by CN code"),
    importer_eori: str | None = Query(default=None, description="Filter by importer EORI"),
):
    """Return rolling SEE history for a supplier across all CN codes (or a specific one).

    Useful for auditors and compliance officers to inspect the values used in
    the B2 supplier consistency check.

    Requires scope: ``cbam:read``
    """
    auth = getattr(request.state, "auth_context", None)
    tenant_id = getattr(auth, "tenant_id", "") or ""

    with engine.connect() as conn:
        try:
            params: dict = {"supplier_eori": supplier_eori}
            filters = ["supplier_eori = :supplier_eori"]

            if cn_code:
                filters.append("cn_code = :cn_code")
                params["cn_code"] = cn_code
            if importer_eori:
                filters.append("importer_eori = :importer_eori")
                params["importer_eori"] = importer_eori
            if tenant_id:
                filters.append("tenant_id = :tenant_id")
                params["tenant_id"] = tenant_id

            where = " AND ".join(filters)
            rows = conn.execute(
                text(f"""
                    SELECT supplier_eori, cn_code, see_tco2e_per_t,
                           reporting_period, case_id
                    FROM cbam.supplier_see_history
                    WHERE {where}
                    ORDER BY cn_code, reporting_period ASC
                """),
                params,
            ).mappings().all()
        except Exception:
            return {"supplier_eori": supplier_eori, "history": [], "note": "No history table yet"}

    return {
        "supplier_eori": supplier_eori,
        "history": [
            {
                "cn_code": str(r["cn_code"]),
                "see_tco2e_per_t": float(_D(str(r["see_tco2e_per_t"]))),
                "reporting_period": str(r["reporting_period"]),
                "case_id": str(r["case_id"]),
            }
            for r in rows
        ],
    }
