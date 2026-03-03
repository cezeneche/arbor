"""
CBAM Compliance Pack Builder

Assembles the internal compliance_pack_v1 artifact and serialises it to the
official EU CBAM Transitional Registry submission schema.

Regulation references
---------------------
EU Regulation 2023/956, Article 35 — quarterly CBAM report obligation
Commission Implementing Regulation (EU) 2023/1773:
  - Article 6     — content of the quarterly CBAM report
  - Annex I       — structure of the CBAM report (DG TAXUD schema)
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _canonical_json(payload: object) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _build_data_quality_flags(report_package: dict) -> list[str]:
    flags: list[str] = []
    shipments = report_package.get("shipments") or []

    for shipment_bundle in shipments:
        shipment = shipment_bundle.get("shipment") or {}
        shipment_id = shipment.get("id")
        invoice_number = shipment.get("invoice_number")
        entry_reference = shipment.get("entry_reference")

        if not invoice_number:
            flags.append(f"shipment:{shipment_id}:invoice_number_missing")
        if not entry_reference:
            flags.append(f"shipment:{shipment_id}:entry_reference_missing")

        for goods_bundle in shipment_bundle.get("goods_lines") or []:
            goods_line = goods_bundle.get("goods_line") or {}
            goods_line_id = goods_line.get("id")
            latest_emissions = goods_bundle.get("latest_emissions")

            if not goods_line.get("installation_id"):
                flags.append(f"goods_line:{goods_line_id}:installation_id_missing")

            if latest_emissions is None:
                flags.append(f"goods_line:{goods_line_id}:emissions_missing")
                continue

            method = latest_emissions.get("method") or latest_emissions.get("calculation_method")
            if method != "actual":
                flags.append(f"goods_line:{goods_line_id}:method_not_actual")

    return flags


def _build_goods_lines_table(report_package: dict) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    shipments = report_package.get("shipments") or []

    for shipment_bundle in shipments:
        shipment = shipment_bundle.get("shipment") or {}
        shipment_label = shipment.get("entry_reference") or shipment.get("id")

        for goods_bundle in shipment_bundle.get("goods_lines") or []:
            goods_line = goods_bundle.get("goods_line") or {}
            latest_emissions = goods_bundle.get("latest_emissions") or {}

            mass = goods_line.get("net_mass_kg")
            if mass is None:
                mass = goods_line.get("quantity")

            direct = latest_emissions.get("direct_embedded_kgco2e")
            if direct is None:
                direct = latest_emissions.get("direct_emissions_kgco2e")

            indirect = latest_emissions.get("indirect_embedded_kgco2e")
            if indirect is None:
                indirect = latest_emissions.get("indirect_emissions_kgco2e")

            rows.append(
                {
                    "shipment": shipment_label,
                    "goods_line_id": goods_line.get("id"),
                    "cn_code": goods_line.get("cn_code"),
                    "mass_kg": _to_float(mass),
                    "direct_embedded_kgco2e": _to_float(direct),
                    "indirect_embedded_kgco2e": _to_float(indirect),
                    "method": latest_emissions.get("method") or latest_emissions.get("calculation_method"),
                }
            )

    return rows


# ── DG TAXUD registry schema constants ───────────────────────────────────────

_REGISTRY_SCHEMA_VERSION = "1.0"
_REGISTRY_SCHEMA_REF = (
    "EU Commission Implementing Regulation 2023/1773, Annex I — "
    "CBAM Transitional Registry quarterly report structure"
)

# Method code mapping → DG TAXUD registry method identifiers
# Source: CIR 2023/1773 Art. 4 (actual monitoring) and Art. 5 (default values)
_METHOD_CODES: dict[str, str] = {
    "actual":    "ACTUAL_MONITORING",
    "default":   "DEFAULT_VALUES",
    "estimated": "ESTIMATED",
}

_KG_TO_T = 1000.0  # 1 tonne = 1000 kg


def _kg_to_tco2e(value_kg: float, precision: int = 6) -> float:
    """Convert kgCO2e to tCO2e, rounded to ``precision`` decimal places."""
    return round(value_kg / _KG_TO_T, precision)


def serialise_to_registry_schema(compliance_pack: dict) -> dict:
    """Serialise a compliance pack to the DG TAXUD quarterly report schema.

    Maps the internal ``cbam_compliance_pack_v1`` structure to the official
    EU CBAM Transitional Registry submission format defined in
    Commission Implementing Regulation (EU) 2023/1773, Annex I.

    Key conversions
    ---------------
    - Emission values: kgCO2e → tCO2e (÷ 1000)
    - Field names:     snake_case → camelCase (EU schema convention)
    - Quarter:         integer 1–4 → "Q1"–"Q4"
    - Method codes:    "actual" → "ACTUAL_MONITORING", etc.

    Parameters
    ----------
    compliance_pack:
        A ``cbam_compliance_pack_v1`` dict as produced by
        ``build_cbam_compliance_pack()``.

    Returns
    -------
    dict
        DG TAXUD-schema submission document.
    """
    rp = compliance_pack.get("report_package") or {}
    case = rp.get("case") or {}

    year = int(case.get("reporting_year") or 0)
    quarter = int(case.get("reporting_quarter") or 0)

    # ── Import entries ────────────────────────────────────────────────────────
    import_entries: list[dict] = []
    for shipment_bundle in (rp.get("shipments") or []):
        shipment = shipment_bundle.get("shipment") or {}
        goods_items: list[dict] = []

        for goods_bundle in (shipment_bundle.get("goods_lines") or []):
            goods_line = goods_bundle.get("goods_line") or {}
            emissions = goods_bundle.get("latest_emissions") or {}

            mass_kg = _to_float(
                goods_line.get("net_mass_kg") or goods_line.get("quantity")
            )

            direct_kg = _to_float(
                emissions.get("direct_embedded_kgco2e")
                or emissions.get("direct_emissions_kgco2e")
            )
            indirect_kg = _to_float(
                emissions.get("indirect_embedded_kgco2e")
                or emissions.get("indirect_emissions_kgco2e")
            )
            total_kg = direct_kg + indirect_kg

            raw_method = (
                emissions.get("method") or emissions.get("calculation_method")
            )
            method_code = _METHOD_CODES.get(
                str(raw_method).lower() if raw_method else "", None
            )

            goods_items.append({
                "cnCode": goods_line.get("cn_code"),
                "sector": goods_line.get("sector"),
                "netMassKg": mass_kg,
                "installationId": goods_line.get("installation_id"),
                "installationName": goods_line.get("installation_name"),
                "productionRoute": goods_line.get("production_route"),
                "emissionsDetermination": {
                    "method": method_code,
                    "directEmbeddedEmissionsTco2e": _kg_to_tco2e(direct_kg),
                    "indirectEmbeddedEmissionsTco2e": _kg_to_tco2e(indirect_kg),
                    "totalEmbeddedEmissionsTco2e": _kg_to_tco2e(total_kg),
                    # Populated by caller if a carbon price deduction applies
                    # (EU 2023/956 Art. 9); None = no recognised scheme in origin.
                    "carbonPricePaidEurPerTco2e": None,
                },
            })

        import_entries.append({
            "entryReference": shipment.get("entry_reference"),
            "importDate": str(shipment.get("import_date") or ""),
            "countryOfOrigin": shipment.get("origin_country"),
            "incoterm": shipment.get("incoterm"),
            "goods": goods_items,
        })

    # ── Report totals (kgCO2e → tCO2e) ───────────────────────────────────────
    tables = compliance_pack.get("tables") or {}
    totals = tables.get("totals") or {}

    total_direct_kg = _to_float(totals.get("total_direct_emissions_kgco2e"))
    total_indirect_kg = _to_float(totals.get("total_indirect_emissions_kgco2e"))
    total_embedded_kg = _to_float(totals.get("total_embedded_emissions_kgco2e"))
    total_mass_kg = _to_float(totals.get("total_net_mass_kg"))

    return {
        "schemaVersion": _REGISTRY_SCHEMA_VERSION,
        "schemaRef": _REGISTRY_SCHEMA_REF,
        "reportingPeriod": {
            "year": year,
            "quarter": f"Q{quarter}",
        },
        "declarant": {
            "eori": case.get("importer_eori"),
            "name": case.get("importer_name"),
        },
        "importEntries": import_entries,
        "reportTotals": {
            "totalDirectEmbeddedEmissionsTco2e": _kg_to_tco2e(total_direct_kg),
            "totalIndirectEmbeddedEmissionsTco2e": _kg_to_tco2e(total_indirect_kg),
            "totalEmbeddedEmissionsTco2e": _kg_to_tco2e(total_embedded_kg),
            "totalNetMassKg": total_mass_kg,
            "goodsLinesCount": int(totals.get("total_goods_lines") or 0),
            "shipmentsCount": int(totals.get("shipments_count") or 0),
        },
    }


def build_cbam_compliance_pack(case_id: str, report_package: dict, narrative: dict) -> dict:
    summary = report_package.get("summary") or {}
    goods_lines = _build_goods_lines_table(report_package)
    data_quality_flags = _build_data_quality_flags(report_package)
    generated_at = _now_utc_iso()

    totals = {
        "total_goods_lines": int(summary.get("total_goods_lines") or len(goods_lines)),
        "total_net_mass_kg": _to_float(summary.get("total_net_mass_kg")),
        "total_direct_emissions_kgco2e": _to_float(summary.get("total_direct_emissions_kgco2e")),
        "total_indirect_emissions_kgco2e": _to_float(summary.get("total_indirect_emissions_kgco2e")),
        "total_embedded_emissions_kgco2e": _to_float(summary.get("total_embedded_emissions_kgco2e")),
        "shipments_count": len(report_package.get("shipments") or []),
    }

    pack = {
        "type": "cbam_compliance_pack_v1",
        "case_id": case_id,
        "generated_at": generated_at,
        "report_package": report_package,
        "narrative": narrative,
        "data_quality_flags": data_quality_flags,
        "tables": {
            "goods_lines": goods_lines,
            "totals": totals,
        },
    }

    # Serialise to DG TAXUD Transitional Registry submission schema
    # (EU 2023/1773 Annex I) before computing the audit hash so that
    # the registry_submission is covered by the audit trail.
    pack["registry_submission"] = serialise_to_registry_schema(pack)

    report_audit = report_package.get("audit") if isinstance(report_package, dict) else None
    report_audit = report_audit if isinstance(report_audit, dict) else {}
    pack["audit"] = {
        "document_sha256": report_audit.get("document_sha256"),
        "payload_hash": _sha256_hex(_canonical_json(pack)),
        "snapshot_hash": report_audit.get("snapshot_hash"),
        "parent_hash": report_audit.get("parent_hash"),
        "algo_versions": {
            "compliance_pack_builder": "v1",
            "report_package": report_audit.get("algo_versions") if isinstance(report_audit.get("algo_versions"), dict) else {},
        },
        "model_versions": {
            "report_package": report_audit.get("model_versions") if isinstance(report_audit.get("model_versions"), dict) else {},
        },
        "generated_at": generated_at,
    }
    return pack
