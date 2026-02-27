from fastapi import APIRouter, HTTPException
from typing import Literal

from app.services.ledger_client import fetch_cbam_report_package, fetch_report_package
from app.services.openai_writer import generate_draft
from app.services.claude_reviewer import review_narrative
from app.services.gemini_gate import gate

router = APIRouter()

@router.post("/cases/{case_id}/narrative/pipeline")
def run_pipeline(case_id: str, packet_kind: Literal["legacy", "cbam"] = "legacy"):
    # 1) Fetch structured packet from núcleo-ledger
    try:
        packet = (
            fetch_cbam_report_package(case_id)
            if packet_kind == "cbam"
            else fetch_report_package(case_id)
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Failed to fetch report-package from nucleo-ledger",
                "error": str(e),
                "case_id": case_id,
                "packet_kind": packet_kind,
            },
        )

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
