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
