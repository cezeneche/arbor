from __future__ import annotations

from decimal import Decimal, InvalidOperation

from ledger_app.services.cbam_emission_factors import validate_against_defaults
from ledger_app.services.cbam_installation_registry import validate_installation_id
from ledger_app.services.cbam_mrn import validate_mrn
from ledger_app.services.cbam_taric import lookup_sector


def _add_unique(items: list[str], value: str) -> None:
    if value not in items:
        items.append(value)


def _to_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ── Risk-weighted scoring ─────────────────────────────────────────────────────
#
# Each issue code is matched by substring (first match wins).  Weights reflect
# regulatory severity:
#   - Missing issues are always blocking (any missing → blocking=True) and carry
#     higher penalties because they prevent declaration submission.
#   - Warning issues are non-blocking but reduce the quality score.
#
# Regulatory basis:
#   EU Reg. 2023/956 Art. 35 (quarterly report obligation)
#   Commission Implementing Reg. (EU) 2023/1773 Art. 6 (report content)

_MISSING_WEIGHT_MAP: list[tuple[str, int]] = [
    # Case-level — declarant identity (blocking to registry submission)
    ("case:importer_eori_missing",        50),
    ("case:reporting_year_missing",       40),
    ("case:reporting_quarter_missing",    40),
    # Shipment-level
    (":origin_country_missing",           30),
    # Goods-line level
    (":cn_code_missing",                  30),
    (":mass_missing_or_non_positive",     25),
    (":missing_emissions",                25),
]
_DEFAULT_MISSING_WEIGHT = 20

_WARNING_WEIGHT_MAP: list[tuple[str, int]] = [
    # Customs reconciliation (EU UCC 952/2013 Art. 5(10))
    (":entry_reference_format_invalid",               15),
    # Monitoring method (actual preferred per EU 2023/1773 Art. 4)
    (":method_not_actual",                            15),
    # Sector/CN code mismatch (EU 2023/956 Annex I)
    (":sector_mismatch",                              12),
    # Installation registry — actual method requires registered ID
    ("installation_id_required_for_actual_method",    12),
    # Emission factor plausibility (EU 2023/1773 Annex VI)
    ("cbam_factors:actual_implausibly_",              12),
    ("cbam_factors:default_deviation:",               10),
    # Installation ID format / allowlist issues
    (":installation_id_format_suspect:",              10),
    (":installation_id_not_in_allowlist:",            10),
    # Installation ID absent (transitional — not blocking)
    (":installation_id_missing",                      10),
    # No published default factor for this CN code
    ("cbam_factors:no_default_factor:",                8),
    # MRN absent (vs format_invalid above)
    (":entry_reference_missing",                       8),
    # Low-severity administrative gaps
    (":invoice_number_missing",                        5),
    (":incoterm_missing",                              5),
]
_DEFAULT_WARNING_WEIGHT = 5


def _issue_weight(
    issue: str, weight_map: list[tuple[str, int]], default: int
) -> int:
    for pattern, weight in weight_map:
        if pattern in issue:
            return weight
    return default


def _compute_score(missing: list[str], warnings: list[str]) -> float:
    penalty = sum(
        _issue_weight(m, _MISSING_WEIGHT_MAP, _DEFAULT_MISSING_WEIGHT)
        for m in missing
    ) + sum(
        _issue_weight(w, _WARNING_WEIGHT_MAP, _DEFAULT_WARNING_WEIGHT)
        for w in warnings
    )
    return round(max(0.0, 100.0 - float(penalty)), 2)


def _risk_tier(score: float, blocking: bool) -> str:
    """Map score + blocking flag to a human-readable risk tier.

    Tiers
    -----
    blocking : One or more *missing* (blocking) issues are present.
    high     : Score < 60 — significant data quality gaps.
    medium   : 60 ≤ score < 80 — moderate quality concerns.
    low      : score ≥ 80 — acceptable quality.
    """
    if blocking:
        return "blocking"
    if score < 60:
        return "high"
    if score < 80:
        return "medium"
    return "low"


# ── Field checks ──────────────────────────────────────────────────────────────

def _check_case(case_row: dict[str, object], missing: list[str]) -> None:
    if not case_row.get("importer_eori"):
        _add_unique(missing, "case:importer_eori_missing")
    if case_row.get("reporting_year") is None:
        _add_unique(missing, "case:reporting_year_missing")
    if case_row.get("reporting_quarter") is None:
        _add_unique(missing, "case:reporting_quarter_missing")


def _check_shipment(
    shipment: dict[str, object],
    missing: list[str],
    warnings: list[str],
) -> None:
    shipment_id = shipment.get("id")
    if not shipment.get("origin_country"):
        _add_unique(missing, f"shipment:{shipment_id}:origin_country_missing")
    if not shipment.get("invoice_number") and not shipment.get("entry_reference"):
        _add_unique(warnings, f"shipment:{shipment_id}:invoice_number_missing")
    entry_reference = shipment.get("entry_reference")
    if not entry_reference:
        _add_unique(warnings, f"shipment:{shipment_id}:entry_reference_missing")
    else:
        mrn = validate_mrn(entry_reference)
        if mrn.format_invalid:
            # MRN present but does not match EU 18-char format (UCC Annex B).
            # Customs authorities cannot reconcile this shipment against the
            # customs declaration (SAD/H1) without a valid MRN.
            _add_unique(warnings, f"shipment:{shipment_id}:entry_reference_format_invalid")
    if not shipment.get("incoterm"):
        _add_unique(warnings, f"shipment:{shipment_id}:incoterm_missing")


def _check_goods_line(
    goods_line: dict[str, object],
    missing: list[str],
    warnings: list[str],
) -> None:
    goods_line_id = goods_line.get("id")
    if not goods_line.get("cn_code"):
        _add_unique(missing, f"goods_line:{goods_line_id}:cn_code_missing")

    mass_value = goods_line.get("net_mass_kg")
    if mass_value is None:
        mass_value = goods_line.get("quantity")
    numeric_mass = _to_float(mass_value)
    if numeric_mass is None or numeric_mass <= 0:
        _add_unique(missing, f"goods_line:{goods_line_id}:mass_missing_or_non_positive")

    # installation_id: always warn if absent; blocking check for "actual" is in
    # _check_installation_registry (called separately with the method context).
    if not goods_line.get("installation_id"):
        _add_unique(warnings, f"goods_line:{goods_line_id}:installation_id_missing")


def _check_sector(
    goods_line: dict[str, object],
    warnings: list[str],
) -> None:
    """Validate the declared sector against the authoritative TARIC CN code table.

    If the goods line declares a ``sector`` that disagrees with the sector the
    CN code maps to in EU Regulation 2023/956 Annex I, a warning is raised.
    This catches mis-categorised goods that could lead to wrong default emission
    factors being applied or the shipment falling outside CBAM scope.
    """
    cn_code = goods_line.get("cn_code")
    declared_sector = goods_line.get("sector")
    if not cn_code or not declared_sector:
        return

    expected_sector = lookup_sector(str(cn_code))
    if expected_sector is None:
        # CN code is not in CBAM scope — flagged elsewhere (cbam_taric);
        # do not double-warn here.
        return

    if str(declared_sector).lower() != expected_sector.lower():
        goods_line_id = goods_line.get("id")
        _add_unique(
            warnings,
            f"goods_line:{goods_line_id}:sector_mismatch:"
            f"declared={declared_sector!r} expected={expected_sector!r} "
            f"for cn_code={cn_code!r} per EU 2023/956 Annex I",
        )


def _check_emissions(
    goods_line: dict[str, object],
    emissions: dict[str, object] | None,
    missing: list[str],
    warnings: list[str],
) -> None:
    goods_line_id = goods_line.get("id")
    if emissions is None:
        _add_unique(missing, f"goods_line:{goods_line_id}:missing_emissions")
        return

    method = emissions.get("method") or emissions.get("calculation_method")
    if method != "actual":
        _add_unique(warnings, f"goods_line:{goods_line_id}:method_not_actual")


def _check_installation_registry(
    goods_line: dict[str, object],
    emissions: dict[str, object] | None,
    missing: list[str],
    warnings: list[str],
) -> None:
    """Validate installation_id against EU CBAM registry rules (EU 2023/956 Art. 10).

    All registry issues (absent ID, bad format, unknown allowlist ID) are surfaced
    as warnings rather than blocking missing issues.  The transitional period
    tolerates incomplete installation registration; missing IDs are flagged for
    human review but do not prevent declaration submission.
    """
    if emissions is None:
        return

    method = emissions.get("method") or emissions.get("calculation_method")
    if not method:
        return

    goods_line_id = str(goods_line.get("id") or "")
    installation_id = goods_line.get("installation_id")

    result = validate_installation_id(
        installation_id=str(installation_id) if installation_id else None,
        method=str(method),
        goods_line_id=goods_line_id,
    )
    # All registry issues go to warnings (not blocking missing) at data-quality level.
    for issue in result.missing:
        _add_unique(warnings, issue)
    for w in result.warnings:
        _add_unique(warnings, w)


def _check_default_factors(
    goods_line: dict[str, object],
    emissions: dict[str, object] | None,
    warnings: list[str],
) -> None:
    """Validate submitted emission values against published Annex VI defaults.

    Issues warnings when submitted values deviate significantly from the
    EU 2023/1773 Annex VI reference values.
    """
    if emissions is None:
        return

    cn_code = goods_line.get("cn_code")
    if not cn_code:
        return

    method = emissions.get("method") or emissions.get("calculation_method")
    if method not in ("default", "actual"):
        return

    mass_raw = goods_line.get("net_mass_kg") or goods_line.get("quantity")
    try:
        net_mass_kg: Decimal | None = Decimal(str(mass_raw)) if mass_raw is not None else None
    except (InvalidOperation, TypeError):
        net_mass_kg = None

    direct_raw = (
        emissions.get("direct_emissions_kgco2e")
        or emissions.get("direct_embedded_kgco2e")
    )
    try:
        direct_kgco2e: Decimal | None = (
            Decimal(str(direct_raw)) if direct_raw is not None else None
        )
    except (InvalidOperation, TypeError):
        direct_kgco2e = None

    vr = validate_against_defaults(
        str(cn_code),
        str(method),
        direct_kgco2e,
        net_mass_kg,
    )
    for w in vr.warnings:
        _add_unique(warnings, w)


def evaluate_cbam_data_quality(
    case_row: dict[str, object],
    shipments_payload: list[dict[str, object]],
) -> dict[str, object]:
    missing: list[str] = []
    warnings: list[str] = []

    _check_case(case_row, missing)

    for shipment_bundle in shipments_payload:
        shipment = shipment_bundle.get("shipment") or {}
        _check_shipment(shipment, missing, warnings)

        for goods_bundle in shipment_bundle.get("goods_lines") or []:
            goods_line = goods_bundle.get("goods_line") or {}
            emissions = goods_bundle.get("latest_emissions")

            _check_goods_line(goods_line, missing, warnings)
            _check_sector(goods_line, warnings)
            _check_emissions(goods_line, emissions, missing, warnings)
            _check_installation_registry(goods_line, emissions, missing, warnings)
            _check_default_factors(goods_line, emissions, warnings)

    is_blocking = bool(missing)
    score = _compute_score(missing, warnings)

    return {
        "missing": missing,
        "warnings": warnings,
        "score": score,
        "blocking": is_blocking,
        "risk_tier": _risk_tier(score, is_blocking),
    }
