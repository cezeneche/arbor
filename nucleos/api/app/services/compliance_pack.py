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
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

# EU MRN: YY + CC (2 letters) + 13 alphanumeric + 1 check digit = 18 chars
# Source: EU UCC Reg. 952/2013; Commission Del. Reg. 2015/2446 Annex B
_MRN_RE = re.compile(r"^[0-9]{2}[A-Z]{2}[A-Z0-9]{13}[0-9]$")


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _canonical_json(payload: object) -> str:
    def _default(obj: Any) -> Any:
        if isinstance(obj, Decimal):
            return str(obj)
        raise TypeError(f"Object of type {type(obj).__name__} is not JSON serialisable")
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=_default)


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
        elif not _MRN_RE.match(entry_reference.strip().upper()):
            flags.append(f"shipment:{shipment_id}:entry_reference_format_invalid")

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
                    "mass_kg": _to_decimal(mass),
                    "direct_embedded_kgco2e": _to_decimal(direct),
                    "indirect_embedded_kgco2e": _to_decimal(indirect),
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

_KG_TO_T = Decimal("1000")


def _kg_to_tco2e(value_kg: Decimal, precision: int = 6) -> Decimal:
    """Convert kgCO2e to tCO2e using Decimal arithmetic to avoid float rounding drift."""
    quantizer = Decimal("0." + "0" * precision)
    return (value_kg / _KG_TO_T).quantize(quantizer, rounding=ROUND_HALF_UP)


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

    # EU 2023/956 Art. 9 — carbon price paid in origin country (EUR/tCO2e).
    # Set at compliance pack level; applies uniformly to all goods lines.
    # None when no recognised equivalent carbon pricing scheme applies.
    _cpp_raw = compliance_pack.get("carbon_price_paid_eur_per_tco2e")
    _carbon_price_paid: Decimal | None = (
        _to_decimal(_cpp_raw) if _cpp_raw is not None and _to_decimal(_cpp_raw) > Decimal("0") else None
    )

    # ── Import entries ────────────────────────────────────────────────────────
    import_entries: list[dict] = []
    for shipment_bundle in (rp.get("shipments") or []):
        shipment = shipment_bundle.get("shipment") or {}
        goods_items: list[dict] = []

        for goods_bundle in (shipment_bundle.get("goods_lines") or []):
            goods_line = goods_bundle.get("goods_line") or {}
            emissions = goods_bundle.get("latest_emissions") or {}

            mass_kg = _to_decimal(
                goods_line.get("net_mass_kg") or goods_line.get("quantity")
            )

            direct_kg = _to_decimal(
                emissions.get("direct_embedded_kgco2e")
                or emissions.get("direct_emissions_kgco2e")
            )
            indirect_kg = _to_decimal(
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
                    # EU 2023/956 Art. 9: carbon price already paid in origin country.
                    # Populated from compliance_pack["carbon_price_paid_eur_per_tco2e"]
                    # when a recognised third-country scheme applies; None otherwise.
                    "carbonPricePaidEurPerTco2e": _carbon_price_paid,
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

    total_direct_kg = _to_decimal(totals.get("total_direct_emissions_kgco2e"))
    total_indirect_kg = _to_decimal(totals.get("total_indirect_emissions_kgco2e"))
    total_embedded_kg = _to_decimal(totals.get("total_embedded_emissions_kgco2e"))
    total_mass_kg = _to_decimal(totals.get("total_net_mass_kg"))

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
        "total_net_mass_kg": _to_decimal(summary.get("total_net_mass_kg")),
        "total_direct_emissions_kgco2e": _to_decimal(summary.get("total_direct_emissions_kgco2e")),
        "total_indirect_emissions_kgco2e": _to_decimal(summary.get("total_indirect_emissions_kgco2e")),
        "total_embedded_emissions_kgco2e": _to_decimal(summary.get("total_embedded_emissions_kgco2e")),
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
