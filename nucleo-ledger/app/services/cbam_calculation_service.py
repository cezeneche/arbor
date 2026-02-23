from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import object_session

from app.models.cbam import CBAMEmission, CBAMGoodsLine
from app.schemas.cbam import CBAMEmissionsCreate


def compute_cbam_emissions(
    goods_line: CBAMGoodsLine,
    inputs: CBAMEmissionsCreate,
    factors: Mapping[str, Any] | None,
) -> CBAMEmission:
    session = None
    if factors:
        session = factors.get("db_session")

    if session is None:
        session = object_session(goods_line)

    if session is None:
        raise ValueError("No active database session found for goods_line.")

    next_version = session.execute(
        text(
            """
            SELECT COALESCE(MAX(version), 0) + 1 AS next_version
            FROM cbam.cbam_emissions
            WHERE goods_line_id = :goods_line_id
            """
        ),
        {"goods_line_id": str(goods_line.id)},
    ).scalar_one()

    direct = Decimal(inputs.direct_embedded_kgco2e or 0)
    indirect = inputs.indirect_embedded_kgco2e
    total = direct + Decimal(indirect or 0)

    notes = inputs.notes
    if notes:
        notes = f"{notes} | computed_total_kgco2e={total}"
    else:
        notes = f"computed_total_kgco2e={total}"

    emission = CBAMEmission(
        id=uuid4(),
        goods_line_id=goods_line.id,
        method=inputs.method,
        direct_embedded_kgco2e=direct,
        indirect_embedded_kgco2e=indirect,
        data_quality_score=inputs.data_quality_score,
        notes=notes,
        version=int(next_version),
    )
    session.add(emission)
    return emission
