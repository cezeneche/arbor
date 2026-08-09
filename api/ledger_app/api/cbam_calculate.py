"""Internal calculation endpoint: confirmed goods lines in, computed declaration out.

POST /internal/calculate

Synchronous, because the calculation is pure and fast — there is nothing to wait
on once the values are in hand. That is only true because the CPR persistence
helpers moved to cpr_repository; the calculator itself touches no database.

Fails closed. A calculation that cannot be completed returns an error rather
than a partial figure: a declaration short by one goods line looks exactly like
a complete one, and the number is what gets filed.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from fastapi import APIRouter, HTTPException, status

from ledger_app.contract.models import (
    CalculatedLine,
    CalculationResult,
    DeclarationPayload,
    DecisionAtom,
    EngineVersions,
    RejectedMethod,
)
from ledger_app.core.version import APP_VERSION
from ledger_app.services.cbam_emission_factors import FACTOR_METADATA
from ledger_app.services.cbam_emissions_selector import select_and_calculate

from app.services.cbam_default_markup import MARKUP_TABLE_VERSION

_log = logging.getLogger("nucleos.cbam_calculate")

router = APIRouter(tags=["cbam-calculate"])


def _engine_versions() -> EngineVersions:
    """Stamped into the response itself, not inherited transitively.

    A figure that cannot name the tables that produced it cannot be reproduced
    once those tables move on, and regulatory tables are versioned precisely
    because they do.
    """
    return EngineVersions(
        engine_version=APP_VERSION,
        annex_vi_factor_version=str(FACTOR_METADATA.get("table_version") or ""),
        markup_table_version=MARKUP_TABLE_VERSION,
        regulation_reference="Commission Implementing Regulation (EU) 2023/1773",
    )


@router.post(
    "/internal/calculate",
    response_model=CalculationResult,
    status_code=status.HTTP_200_OK,
)
def calculate_declaration(payload: DeclarationPayload) -> CalculationResult:
    lines: list[CalculatedLine] = []
    warnings: list[str] = []
    total = Decimal("0")

    for line in payload.lines:
        try:
            selection = select_and_calculate(
                cn_code=line.cn_code,
                net_mass_kg=Decimal(str(line.net_mass_kg)),
                direct_kgco2e_supplier=(
                    Decimal(str(line.direct_embedded_kgco2e))
                    if line.direct_embedded_kgco2e is not None else None
                ),
                indirect_kgco2e_supplier=(
                    Decimal(str(line.indirect_embedded_kgco2e))
                    if line.indirect_embedded_kgco2e is not None else None
                ),
                supplier_direct_confidence=line.supplier_direct_confidence or 0.0,
                supplier_indirect_confidence=line.supplier_indirect_confidence or 0.0,
                production_route=line.production_route,
                force_method=(
                    line.declared_emissions_method.value.lower()
                    if line.declared_emissions_method else None
                ),
                reporting_year=payload.reporting_year,
                jurisdiction=payload.jurisdiction.value,
            )
        except Exception as exc:
            # One line that cannot be calculated invalidates the declaration.
            # Returning the rest would produce a total that looks complete.
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Line {line.line_id} could not be calculated: {exc}",
            ) from exc

        warnings.extend(selection.warnings)
        total += selection.embedded_tco2e

        lines.append(
            CalculatedLine(
                line_id=line.line_id,
                emissions_method=selection.method.upper(),
                # Echoed back unchanged. Nucleos reads provenance and never sets
                # it — only a human action in Arbor's Review screen does.
                provenance_tier=line.provenance_tier,
                direct_kgco2e=float(selection.direct_kgco2e),
                indirect_kgco2e=float(selection.indirect_kgco2e),
                see_direct_tco2e_per_t=float(selection.see_direct_tco2e_per_t),
                see_indirect_tco2e_per_t=float(selection.see_indirect_tco2e_per_t),
                see_total_tco2e_per_t=float(selection.see_total_tco2e_per_t),
                embedded_tco2e=float(selection.embedded_tco2e),
                markup_fraction=float(selection.markup_fraction),
                annex_vi_factor_used=selection.annex_vi_factor_used,
                rejected_methods=[
                    RejectedMethod(
                        method=str(r["method"]).upper(),
                        regulation_tier=r.get("regulation_tier"),
                        reason=r["reason"],
                        regulation_ref=r["regulation_ref"],
                    )
                    for r in selection.rejected_method_reasons
                ],
                decision_trace=[
                    DecisionAtom(
                        step=atom.step,
                        outcome=atom.outcome,
                        detail=atom.detail,
                        value=atom.value,
                        regulation_ref=atom.regulation_ref or None,
                    )
                    for atom in selection.decision_trace
                ],
                warnings=list(selection.warnings),
            )
        )

    return CalculationResult(
        case_reference=payload.case_reference,
        jurisdiction=payload.jurisdiction,
        reporting_year=payload.reporting_year,
        reporting_quarter=payload.reporting_quarter,
        lines=lines,
        total_embedded_tco2e=float(total),
        warnings=warnings,
        engine=_engine_versions(),
    )
