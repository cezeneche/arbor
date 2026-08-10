from __future__ import annotations

import json
import re
from decimal import Decimal
from typing import Any

from ledger_app.services.snapshot_store import SnapshotRecord
from ledger_app.services.snapshot_store import SnapshotStore
from ledger_app.services.snapshot_store import sha256_hex


_METRIC_DEFINITIONS: dict[str, tuple[str, str]] = {
    "total_goods_lines": (
        "Total number of goods lines in the case.",
        "COUNT(goods_lines)",
    ),
    "total_net_mass_kg": (
        "Total declared net mass across all goods lines.",
        "SUM(goods_line.net_mass_kg OR goods_line.quantity)",
    ),
    "total_direct_emissions_kgco2e": (
        "Total direct embedded emissions from latest emissions records.",
        "SUM(latest_emissions.direct_embedded_kgco2e)",
    ),
    "total_indirect_emissions_kgco2e": (
        "Total indirect embedded emissions from latest emissions records.",
        "SUM(latest_emissions.indirect_embedded_kgco2e)",
    ),
    "total_embedded_emissions_kgco2e": (
        "Total embedded emissions as direct plus indirect emissions.",
        "SUM(latest_emissions.direct_embedded_kgco2e + latest_emissions.indirect_embedded_kgco2e)",
    ),
}


def _to_decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _payload(snapshot: SnapshotRecord | None) -> dict[str, Any]:
    if snapshot is None:
        return {}
    try:
        loaded = json.loads(snapshot.payload_json)
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


def _path_tokens(path: str) -> list[str | int]:
    tokens: list[str | int] = []
    for segment in path.split("."):
        if not segment:
            continue
        parts = re.findall(r"([^\[\]]+)|\[(\d+)\]", segment)
        for key, idx in parts:
            if key:
                tokens.append(key)
            elif idx:
                tokens.append(int(idx))
    return tokens


def resolve_field_path(data: Any, path: str) -> Any:
    current = data
    for token in _path_tokens(path):
        if isinstance(token, int):
            if not isinstance(current, list) or token >= len(current):
                return None
            current = current[token]
            continue

        if not isinstance(current, dict):
            return None
        current = current.get(token)
    return current


def _latest_by_stages(store: SnapshotStore, case_id: str, stages: list[str]) -> SnapshotRecord | None:
    for stage in stages:
        snapshot = store.latest_snapshot_by_stage(case_id, stage)
        if snapshot is not None:
            return snapshot
    return None


def _extract_document_hash(extraction_payload: dict[str, Any]) -> str | None:
    raw_text = extraction_payload.get("raw_text")
    if isinstance(raw_text, str) and raw_text:
        return sha256_hex(raw_text)
    return None


def _goods_rows_from_report_package(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    shipments = payload.get("shipments")
    if not isinstance(shipments, list):
        return rows

    for shipment_wrapper in shipments:
        if not isinstance(shipment_wrapper, dict):
            continue
        shipment = shipment_wrapper.get("shipment") if isinstance(shipment_wrapper.get("shipment"), dict) else {}
        goods_lines = shipment_wrapper.get("goods_lines")
        if not isinstance(goods_lines, list):
            continue
        for goods_wrapper in goods_lines:
            if not isinstance(goods_wrapper, dict):
                continue
            goods_line = goods_wrapper.get("goods_line") if isinstance(goods_wrapper.get("goods_line"), dict) else {}
            latest_emissions = goods_wrapper.get("latest_emissions")
            latest_emissions = latest_emissions if isinstance(latest_emissions, dict) else {}
            rows.append(
                {
                    "shipment": shipment,
                    "goods_line": goods_line,
                    "latest_emissions": latest_emissions,
                }
            )
    return rows


def _goods_rows_from_repaired(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    lines = payload.get("lines")
    global_emissions = payload.get("emissions") if isinstance(payload.get("emissions"), dict) else {}
    if not isinstance(lines, list):
        return rows

    for idx, line in enumerate(lines):
        if not isinstance(line, dict):
            continue
        latest_emissions = {
            "direct_embedded_kgco2e": line.get("direct_embedded_kgco2e", global_emissions.get("direct_embedded_kgco2e")),
            "indirect_embedded_kgco2e": line.get("indirect_embedded_kgco2e", global_emissions.get("indirect_embedded_kgco2e")),
            "method": line.get("method", global_emissions.get("method")),
        }
        rows.append(
            {
                "shipment": {},
                "goods_line": {"id": f"line_{idx}", **line},
                "latest_emissions": latest_emissions,
            }
        )
    return rows


def _metric_contribution(metric: str, row: dict[str, Any]) -> Decimal:
    goods_line = row.get("goods_line") if isinstance(row.get("goods_line"), dict) else {}
    latest_emissions = row.get("latest_emissions") if isinstance(row.get("latest_emissions"), dict) else {}

    mass = _to_decimal(goods_line.get("net_mass_kg") if goods_line.get("net_mass_kg") is not None else goods_line.get("quantity"))

    direct = _to_decimal(
        latest_emissions.get("direct_embedded_kgco2e")
        if latest_emissions.get("direct_embedded_kgco2e") is not None
        else latest_emissions.get("direct_emissions_kgco2e")
    )
    indirect = _to_decimal(
        latest_emissions.get("indirect_embedded_kgco2e")
        if latest_emissions.get("indirect_embedded_kgco2e") is not None
        else latest_emissions.get("indirect_emissions_kgco2e")
    )

    if metric == "total_goods_lines":
        return Decimal("1")
    if metric == "total_net_mass_kg":
        return mass
    if metric == "total_direct_emissions_kgco2e":
        return direct
    if metric == "total_indirect_emissions_kgco2e":
        return indirect
    if metric == "total_embedded_emissions_kgco2e":
        return direct + indirect
    return Decimal("0")


def explain_metric(
    *,
    store: SnapshotStore,
    case_id: str,
    metric: str,
) -> dict[str, Any]:
    if metric not in _METRIC_DEFINITIONS:
        raise KeyError(f"Unsupported metric: {metric}")

    relevant_snapshot = _latest_by_stages(store, case_id, ["report_package_v1", "repaired_v1"])
    if relevant_snapshot is None:
        raise LookupError("No relevant snapshot found")

    extraction_snapshot = store.latest_snapshot_by_stage(case_id, "extraction_v1")
    extraction_payload = _payload(extraction_snapshot)
    payload = _payload(relevant_snapshot)

    if relevant_snapshot.stage == "report_package_v1":
        rows = _goods_rows_from_report_package(payload)
        summary_value = resolve_field_path(payload, f"summary.{metric}")
    else:
        rows = _goods_rows_from_repaired(payload)
        summary_value = None

    breakdown: list[dict[str, Any]] = []
    total = Decimal("0")
    for row in rows:
        contribution = _metric_contribution(metric, row)
        total += contribution
        goods_line = row.get("goods_line") if isinstance(row.get("goods_line"), dict) else {}
        latest_emissions = row.get("latest_emissions") if isinstance(row.get("latest_emissions"), dict) else {}
        shipment = row.get("shipment") if isinstance(row.get("shipment"), dict) else {}

        breakdown.append(
            {
                "goods_line_id": goods_line.get("id"),
                "shipment_id": shipment.get("id"),
                "cn_code": goods_line.get("cn_code"),
                "inputs": {
                    "net_mass_kg": goods_line.get("net_mass_kg", goods_line.get("quantity")),
                    "direct_embedded_kgco2e": latest_emissions.get(
                        "direct_embedded_kgco2e",
                        latest_emissions.get("direct_emissions_kgco2e"),
                    ),
                    "indirect_embedded_kgco2e": latest_emissions.get(
                        "indirect_embedded_kgco2e",
                        latest_emissions.get("indirect_emissions_kgco2e"),
                    ),
                    "method": latest_emissions.get("method", latest_emissions.get("calculation_method")),
                },
                "contribution": str(contribution),
            }
        )

    definition, formula = _METRIC_DEFINITIONS[metric]
    summary_decimal = _to_decimal(summary_value) if summary_value is not None else None

    return {
        "case_id": case_id,
        "metric": metric,
        "definition": definition,
        "formula": formula,
        "breakdown": breakdown,
        "total_recomputed": str(total),
        "summary_value": str(summary_decimal) if summary_decimal is not None else None,
        "matches_summary": bool(summary_decimal is not None and summary_decimal == total),
        "integrity": {
            "snapshot_stage": relevant_snapshot.stage,
            "snapshot_hash": relevant_snapshot.payload_hash,
            "parent_hash": relevant_snapshot.parent_hash,
            "document_hash": _extract_document_hash(extraction_payload),
        },
    }


def _collect_evidence(payload: dict[str, Any], field_path: str) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []

    direct = payload.get("evidence")
    if isinstance(direct, list):
        for atom in direct:
            if isinstance(atom, dict) and atom.get("field") == field_path:
                evidence.append(atom)

    candidates = payload.get("candidates")
    if isinstance(candidates, list):
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            candidate_evidence = candidate.get("evidence")
            if not isinstance(candidate_evidence, list):
                continue
            for atom in candidate_evidence:
                if isinstance(atom, dict) and atom.get("field") == field_path:
                    evidence.append(atom)

    # deterministic de-duplication
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for atom in evidence:
        key = json.dumps(atom, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(atom)
    return deduped


def explain_field(
    *,
    store: SnapshotStore,
    case_id: str,
    field_path: str,
) -> dict[str, Any]:
    relevant_snapshot = _latest_by_stages(store, case_id, ["report_package_v1", "repaired_v1"])
    if relevant_snapshot is None:
        raise LookupError("No relevant snapshot found")

    extraction_snapshot = store.latest_snapshot_by_stage(case_id, "extraction_v1")
    arbitrated_snapshot = store.latest_snapshot_by_stage(case_id, "arbitrated_v1")
    repaired_snapshot = store.latest_snapshot_by_stage(case_id, "repaired_v1")

    extraction_payload = _payload(extraction_snapshot)
    arbitrated_payload = _payload(arbitrated_snapshot)
    repaired_payload = _payload(repaired_snapshot)
    relevant_payload = _payload(relevant_snapshot)

    chosen_value = resolve_field_path(relevant_payload, field_path)
    if chosen_value is None and repaired_payload:
        chosen_value = resolve_field_path(repaired_payload, field_path)

    candidates_payload = extraction_payload.get("candidates")
    candidate_values: list[dict[str, Any]] = []
    if isinstance(candidates_payload, list):
        for candidate in candidates_payload:
            if not isinstance(candidate, dict):
                continue
            value = resolve_field_path(candidate, field_path)
            if value is None:
                continue
            candidate_values.append(
                {
                    "source": candidate.get("source", "unknown"),
                    "value": value,
                }
            )

    arbiter_value = resolve_field_path(arbitrated_payload, field_path) if arbitrated_payload else None
    arbiter_warnings = []
    extraction_validation = extraction_payload.get("extraction_validation")
    if isinstance(extraction_validation, dict):
        warnings = extraction_validation.get("arbiter_warnings")
        if isinstance(warnings, list):
            arbiter_warnings = [str(item) for item in warnings]

    evidence = _collect_evidence(repaired_payload if repaired_payload else extraction_payload, field_path)

    return {
        "case_id": case_id,
        "field": field_path,
        "chosen_value": chosen_value,
        "candidate_values": candidate_values,
        "arbiter": {
            "decision": arbiter_value,
            "warnings": arbiter_warnings,
        },
        "evidence": evidence,
        "integrity": {
            "snapshot_stage": relevant_snapshot.stage,
            "snapshot_hash": relevant_snapshot.payload_hash,
            "parent_hash": relevant_snapshot.parent_hash,
            "document_hash": _extract_document_hash(extraction_payload),
        },
    }
