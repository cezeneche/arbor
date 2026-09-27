"""Explain a case's figures, and record the evidence that explains them.

GET  /cbam/cases/{case_id}/explain?metric=... | ?field=...
POST /cbam/cases/{case_id}/evidence

Explain-by-field reads the evidence in the case's repaired_v1 snapshot. Only
the draft intake route ever wrote it, and Arbor never used that route, so for
Arbor's cases explain had nothing to show. Arbor now sends what it read from
each document — value, source text, confidence — and it is recorded here.

Evidence is keyed to Nucleos's goods-line ids ("goods_lines.<id>.net_mass_kg")
and case fields ("case.importer_eori"), not to a document's line positions: a
case gathers lines from several documents, and "lines[0]" of two of them are
different goods. Each submission merges into the latest snapshot rather than
replacing it, so a second document does not hide the first one's evidence.
"""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ledger_app.contract.models import EvidenceAtom

from . import _shared

router = APIRouter()

_EVIDENCE_STAGES = ("arbitrated_v1", "repaired_v1")


class EvidenceSubmission(BaseModel):
    source_ref: str = Field(
        ..., min_length=1, max_length=500,
        description="The Arbor document the evidence was read from.",
    )
    evidence: list[EvidenceAtom] = Field(..., min_length=1, max_length=2000)


def _tenant_id(request: Request) -> str:
    return getattr(getattr(request.state, "auth_context", None), "tenant_id", "") or ""


def _goods_line_ids(conn, case_id: str) -> set[str]:
    rows = conn.execute(
        text(
            """
            SELECT gl.id FROM cbam.cbam_goods_lines gl
            JOIN cbam.cbam_shipments s ON s.id = gl.shipment_id
            WHERE s.case_id = :case_id
            """
        ),
        {"case_id": case_id},
    ).all()
    return {str(r[0]) for r in rows}


def _set_path(payload: dict[str, Any], field: str, value: Any) -> None:
    """Place a value at a dotted path, creating the dicts on the way."""
    keys = field.split(".")
    node = payload
    for key in keys[:-1]:
        node = node.setdefault(key, {})
        if not isinstance(node, dict):
            return
    node[keys[-1]] = value


def _atom_key(atom: dict[str, Any]) -> str:
    return json.dumps(
        [atom.get("field"), atom.get("source"), atom.get("value"), atom.get("snippet")],
        sort_keys=True,
        default=str,
    )


@router.post("/cases/{case_id}/evidence")
def record_case_evidence(request: Request, case_id: UUID, submission: EvidenceSubmission) -> dict:
    tenant_id = _tenant_id(request)
    case_id_str = str(case_id)

    with _shared.engine.begin() as conn:
        _shared.set_tenant_context(conn, tenant_id)
        _shared._require_case_tenant(conn, case_id_str, tenant_id)
        line_ids = _goods_line_ids(conn, case_id_str)

    atoms = [atom.model_dump(mode="json") for atom in submission.evidence]
    for atom in atoms:
        field = str(atom["field"])
        parts = field.split(".")
        if parts[0] == "goods_lines":
            if len(parts) < 3 or parts[1] not in line_ids:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"{field} names a goods line that is not on this case.",
                )
        elif parts[0] != "case" or len(parts) < 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{field} must start with case. or goods_lines.<id>.",
            )

    store = _shared.get_snapshot_store()
    latest = store.latest_snapshot_by_stage(case_id_str, "repaired_v1")
    payload: dict[str, Any] = json.loads(latest.payload_json) if latest is not None else {}
    if not isinstance(payload, dict):
        payload = {}

    seen = {_atom_key(a) for a in payload.get("evidence") or [] if isinstance(a, dict)}
    evidence = list(payload.get("evidence") or [])
    for atom in atoms:
        key = _atom_key(atom)
        if key in seen:
            continue
        seen.add(key)
        evidence.append({**atom, "source_ref": submission.source_ref})
        _set_path(payload, str(atom["field"]), atom.get("value"))
    payload["evidence"] = evidence
    payload["sources"] = sorted({*payload.get("sources", []), submission.source_ref})

    try:
        for stage in _EVIDENCE_STAGES:
            store.append_snapshot(case_id=case_id_str, stage=stage, payload=payload)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The evidence could not be recorded. Nothing was changed; try again.",
        ) from exc

    return {"case_id": case_id_str, "evidence_count": len(evidence), "sources": payload["sources"]}


@router.get("/cases/{case_id}/explain")
def get_cbam_case_explain(
    request: Request,
    case_id: UUID,
    metric: str | None = None,
    field: str | None = None,
):
    if bool(metric) == bool(field):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide exactly one of metric or field.",
        )

    tenant_id = _tenant_id(request)
    case_id_str = str(case_id)
    # Snapshots are read by case id alone, so the case has to be this tenant's
    # before any of them is: explain used to answer for any case id at all.
    with _shared.engine.begin() as conn:
        _shared.set_tenant_context(conn, tenant_id)
        _shared._require_case_tenant(conn, case_id_str, tenant_id)

    snapshot_store = _shared.get_snapshot_store()

    try:
        if metric:
            return _shared.explain_metric(
                store=snapshot_store,
                case_id=case_id_str,
                metric=metric,
            )
        return _shared.explain_field(
            store=snapshot_store,
            case_id=case_id_str,
            field_path=str(field),
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found") from exc
