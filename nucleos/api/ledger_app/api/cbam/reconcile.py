"""A supplier's earlier emissions figures, beside the one on a goods line.

GET /cbam/goods-lines/{goods_line_id}/supplier-history
    The specific embedded emissions (tCO2e per tonne) this line's installation
    reported for the same CN code on earlier goods lines, and whether the line's
    own figure departs from them by more than the B2 threshold.

History is read from the emissions already recorded, so it cannot drift from
them, and it is limited to cases with the same owner_ref: every Arbor
organisation reaches Nucleos as one tenant, so tenant scoping alone would mix
one organisation's suppliers into another's history.

It replaces GET /cbam/suppliers/{supplier_eori}/see-history, which could not
work — an untyped request parameter, columns the table does not have, and a
table nothing wrote — and the quarterly reconciliation route removed with the
pre-integration pipeline (docs/audits/2026-09-27-nucleos-endpoints.md).

Scopes required: ``cbam:read``
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import text

from ledger_app.api.cbam._shared import engine
from ledger_app.db.rls import set_tenant_context
from ledger_app.services.cbam_reconciler import (
    MIN_HISTORY_FOR_STATS,
    SUPPLIER_SEE_DEVIATION_THRESHOLD,
    check_supplier_see_consistency,
)

router = APIRouter(tags=["cbam-supplier-history"])

# Methods whose figure came from the supplier. A default value says nothing
# about the installation, so it is never history.
_SUPPLIER_METHODS = ("actual", "estimated")

# One row per goods line: its case, installation, mass and latest emissions.
# Mass is stored in kg as quantity; the goods-line route writes net_mass_kg
# there when the table has no column of that name.
_LINES = """
    SELECT gl.id            AS goods_line_id,
           gl.cn_code,
           gl.installation_id,
           gl.quantity      AS net_mass_kg,
           c.id             AS case_id,
           c.owner_ref,
           c.reporting_year,
           c.reporting_quarter,
           e.direct_kgco2e,
           e.method
    FROM cbam.cbam_goods_lines gl
    JOIN cbam.cbam_shipments s ON s.id = gl.shipment_id
    JOIN cbam.cbam_cases c     ON c.id = s.case_id
    LEFT JOIN LATERAL (
        SELECT direct_kgco2e, method
        FROM cbam.cbam_emissions
        WHERE goods_line_id = gl.id
        ORDER BY version DESC, created_at DESC
        LIMIT 1
    ) e ON TRUE
    WHERE c.tenant_id = :tenant_id
"""


def _see(row: dict) -> Decimal | None:
    """tCO2e per tonne from a supplier's figure: kgCO2e / kg of goods."""
    if row.get("method") not in _SUPPLIER_METHODS:
        return None
    direct = row.get("direct_kgco2e")
    mass = row.get("net_mass_kg")
    if direct is None or not mass or Decimal(str(mass)) <= 0:
        return None
    return (Decimal(str(direct)) / Decimal(str(mass))).normalize()


def _period(row: dict) -> str:
    return f"{row['reporting_year']}-Q{row['reporting_quarter']}"


@router.get("/goods-lines/{goods_line_id}/supplier-history")
def get_supplier_history(request: Request, goods_line_id: UUID) -> dict:
    tenant_id: str = getattr(getattr(request.state, "auth_context", None), "tenant_id", "") or ""

    with engine.begin() as conn:
        set_tenant_context(conn, tenant_id)
        line = conn.execute(
            text(_LINES + " AND gl.id = :goods_line_id"),
            {"tenant_id": tenant_id, "goods_line_id": str(goods_line_id)},
        ).mappings().one_or_none()
        if line is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goods line not found")
        line = dict(line)

        installation = line.get("installation_id")
        current_see = _see(line)
        base = {
            "goods_line_id": str(goods_line_id),
            "installation_id": installation,
            "cn_code": line["cn_code"],
            "current_see_tco2e_per_t": str(current_see) if current_see is not None else None,
            "threshold_pct": str(SUPPLIER_SEE_DEVIATION_THRESHOLD),
            "min_history": MIN_HISTORY_FOR_STATS,
        }
        if not installation:
            return {
                **base,
                "history": [],
                "rolling_mean": None,
                "deviation_pct": None,
                "flagged": False,
                "note": "No installation is recorded for this goods line, so its supplier's history cannot be found.",
            }

        rows = conn.execute(
            text(
                _LINES
                + """
                  AND gl.installation_id = :installation_id
                  AND gl.cn_code = :cn_code
                  AND gl.id <> :goods_line_id
                  AND c.owner_ref IS NOT DISTINCT FROM :owner_ref
                ORDER BY c.reporting_year, c.reporting_quarter, gl.created_at
                """
            ),
            {
                "tenant_id": tenant_id,
                "installation_id": installation,
                "cn_code": line["cn_code"],
                "goods_line_id": str(goods_line_id),
                "owner_ref": line.get("owner_ref"),
            },
        ).mappings().all()

    history = []
    for row in map(dict, rows):
        see = _see(row)
        if see is None:
            continue
        history.append(
            {
                "case_id": str(row["case_id"]),
                "goods_line_id": str(row["goods_line_id"]),
                "reporting_period": _period(row),
                "see_tco2e_per_t": str(see),
                "method": row["method"],
            }
        )

    flag = (
        check_supplier_see_consistency(
            current_see=current_see,
            cn_code=line["cn_code"],
            supplier_eori=installation,
            history=[Decimal(h["see_tco2e_per_t"]) for h in history],
            history_case_ids=[h["case_id"] for h in history],
        )
        if current_see is not None
        else None
    )
    rolling_mean = None
    if len(history) >= MIN_HISTORY_FOR_STATS:
        values = [Decimal(h["see_tco2e_per_t"]) for h in history]
        rolling_mean = (sum(values) / len(values)).normalize()

    return {
        **base,
        "history": history,
        "rolling_mean": str(rolling_mean) if rolling_mean is not None else None,
        "deviation_pct": str(flag.deviation_pct) if flag else None,
        "flagged": flag is not None,
        "note": None,
    }
