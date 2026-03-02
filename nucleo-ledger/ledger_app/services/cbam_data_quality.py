from __future__ import annotations


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
    if not shipment.get("entry_reference"):
        _add_unique(warnings, f"shipment:{shipment_id}:entry_reference_missing")
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

    if not goods_line.get("installation_id"):
        _add_unique(warnings, f"goods_line:{goods_line_id}:installation_id_missing")


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
            _check_emissions(goods_line, emissions, missing, warnings)

    penalty = (40 * len(missing)) + (10 * len(warnings))
    score = max(0.0, 100.0 - float(penalty))

    return {
        "missing": missing,
        "warnings": warnings,
        "score": round(score, 2),
        "blocking": bool(missing),
    }
