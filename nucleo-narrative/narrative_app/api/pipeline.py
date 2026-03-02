from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from typing import Literal

from narrative_app.services.ledger_client import (
    LedgerClientError,
    fetch_cbam_report_package,
    fetch_report_package,
)
from narrative_app.services.openai_writer import generate_draft
from narrative_app.services.claude_reviewer import review_narrative
from narrative_app.services.gemini_gate import gate

router = APIRouter()


def _blocking_response(case_id: str, data_quality: dict) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "message": "Data quality blocking issues",
            "case_id": case_id,
            "data_quality": data_quality,
        },
    )


def _to_float(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _build_cbam_narrative(packet: dict) -> dict:
    case = packet.get("case") or {}
    summary = packet.get("summary") or {}
    shipments = packet.get("shipments") or []
    importer_name = case.get("importer_name") or case.get("importer_eori") or "unknown importer"
    reporting_year = case.get("reporting_year")
    reporting_quarter = case.get("reporting_quarter")

    total_direct = _to_float(summary.get("total_direct_emissions_kgco2e"))
    total_indirect = _to_float(summary.get("total_indirect_emissions_kgco2e"))
    total_embedded = _to_float(summary.get("total_embedded_emissions_kgco2e"))
    total_net_mass = _to_float(summary.get("total_net_mass_kg"))
    total_goods_lines = int(summary.get("total_goods_lines") or 0)
    shipments_count = len(shipments)

    totals = {
        "total_direct_emissions_kgco2e": total_direct,
        "total_indirect_emissions_kgco2e": total_indirect,
        "total_embedded_emissions_kgco2e": total_embedded,
        "total_net_mass_kg": total_net_mass,
        "total_goods_lines": total_goods_lines,
        "shipments_count": shipments_count,
    }

    executive_summary = (
        f"CBAM report for {importer_name} ({reporting_year} Q{reporting_quarter}) includes "
        f"{shipments_count} shipments and {total_goods_lines} goods lines. "
        f"Total embedded emissions are {total_embedded:.2f} kgCO2e "
        f"({total_direct:.2f} direct, {total_indirect:.2f} indirect)."
    )

    return {
        "type": "cbam_narrative_v1",
        "case_id": case.get("id"),
        "executive_summary": executive_summary,
        "totals": totals,
        "risk_flags": [],
    }


@router.post("/cases/{case_id}/narrative/pipeline")
def run_pipeline(case_id: str, packet_kind: Literal["legacy", "cbam"] = "legacy"):
    # 1) Fetch structured packet from núcleo-ledger
    try:
        packet = (
            fetch_cbam_report_package(case_id)
            if packet_kind == "cbam"
            else fetch_report_package(case_id)
        )
    except LedgerClientError as e:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch report-package from nucleo-ledger",
                "error_code": e.code,
                "error": e.message,
                "case_id": case_id,
                "packet_kind": packet_kind,
                "upstream": e.to_dict(),
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch report-package from nucleo-ledger",
                "error_code": "ledger_down",
                "error": str(e),
                "case_id": case_id,
                "packet_kind": packet_kind,
            },
        )

    packet_type = packet.get("type")
    if packet_type == "cbam_report_package_v1":
        data_quality = packet.get("data_quality") or {}
        if bool(data_quality.get("blocking")):
            return _blocking_response(case_id, data_quality)

        cbam_narrative = _build_cbam_narrative(packet)
        return {
            "case_id": case_id,
            "draft_openai_json": cbam_narrative,
            "claude_review_json": cbam_narrative,
            "gemini_gate": {"approved": True, "issues": []},
            "final_narrative_json": cbam_narrative,
            "human_review_required": False,
            "stage_errors": [],
        }

    result = {
        "case_id": case_id,
        "draft_openai_json": None,
        "claude_review_json": None,
        "gemini_gate": None,
        "final_narrative_json": None,
        "human_review_required": True,
        "stage_errors": [],
    }

    # 2) Draft narrative (OpenAI) — draft only
    try:
        draft = generate_draft(packet)
        result["draft_openai_json"] = draft
    except Exception as e:
        result["stage_errors"].append({"stage": "openai_draft", "error": str(e)})
        # Can't proceed without a draft
        return result

    # 3) Review/refine (Claude)
    try:
        claude_revised = review_narrative(result["draft_openai_json"])

        # Defensive: reviewer must return a JSON object (dict)
        if not isinstance(claude_revised, dict):
            raise ValueError(
                f"Claude reviewer returned non-JSON type: {type(claude_revised).__name__}"
            )

        result["claude_review_json"] = claude_revised
    except Exception as e:
        result["stage_errors"].append({"stage": "claude_review", "error": str(e)})
        # Fall back to the OpenAI draft for Gemini gating (optional)
        result["claude_review_json"] = result["draft_openai_json"]

    # 4) Gate (Gemini) — approve/flag
    try:
        gem = gate(packet, result["claude_review_json"])
        result["gemini_gate"] = gem
        approved = bool(gem.get("approved", False))
        result["final_narrative_json"] = result["claude_review_json"] if approved else None
        result["human_review_required"] = (not approved)
    except Exception as e:
        result["stage_errors"].append({"stage": "gemini_gate", "error": str(e)})
        # If gating fails, require human review and do not publish final
        result["human_review_required"] = True
        result["final_narrative_json"] = None

    return result
