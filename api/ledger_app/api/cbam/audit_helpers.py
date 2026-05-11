from __future__ import annotations

import json

from ledger_app.db.rls import set_tenant_context
from ledger_app.db.session import engine
from ledger_app.schemas.evidence import EvidenceAtom
from ledger_app.services.snapshot_store import get_snapshot_store, sha256_hex


def _normalized_evidence(evidence: object) -> list[dict[str, object]]:
    if not isinstance(evidence, list):
        return []
    normalized: list[dict[str, object]] = []
    for atom in evidence:
        if isinstance(atom, EvidenceAtom):
            normalized.append(atom.model_dump(mode="json"))
        elif isinstance(atom, dict):
            normalized.append(dict(atom))
    return normalized


def _append_llm_evidence(
    evidence: list[dict[str, object]],
    *,
    field: str,
    value: object,
    source: str = "llm",
    confidence: float = 0.35,
) -> None:
    if value in (None, ""):
        return
    evidence.append(
        EvidenceAtom(
            field=field,
            value=value,
            source=source,
            confidence=confidence,
            snippet=None,
        ).model_dump(mode="json")
    )


def _write_audit_event(
    case_id: str,
    event_type: str,
    event_data: dict[str, object],
    actor_sub: str = "system",
    tenant_id: str = "",
) -> None:
    """Write a signed audit_log event for CBAM pipeline stages.

    Silently no-ops if the audit_log table doesn't exist (e.g., older SQLite test DB).
    """
    from sqlalchemy import text

    try:
        from ledger_app.services.audit_signer import get_prev_chain_hmac, sign_event

        effective_tenant = tenant_id or "shared"
        event_json = json.dumps(event_data, sort_keys=True, default=str)
        with engine.begin() as conn:
            set_tenant_context(conn, effective_tenant)
            prev_hmac = get_prev_chain_hmac(case_id, conn)
            sig = sign_event(case_id, event_type, actor_sub, event_json,
                             prev_hmac=prev_hmac)
            conn.execute(
                text("""
                    INSERT INTO cbam.audit_log
                        (tenant_id, case_id, event_type, actor,
                         payload, signature, chain_hash)
                    VALUES
                        (:tenant_id, :case_id, :event_type, :actor,
                         CAST(:event_json AS jsonb), :sig, :prev_hmac)
                """),
                {
                    "tenant_id": effective_tenant,
                    "case_id": case_id,
                    "event_type": event_type,
                    "actor": actor_sub,
                    "event_json": event_json,
                    "sig": sig,
                    "prev_hmac": prev_hmac,
                },
            )
    except Exception:
        # Audit write must never break the caller.
        pass

    # Slack notification — separate try/except so it fires even when the DB
    # write is skipped and never blocks the caller regardless of network state.
    try:
        from ledger_app.services.slack_notifier import notify as _slack_notify

        _slack_notify(case_id, event_type, event_data)
    except Exception:
        pass


def _safe_snapshot_write(
    *,
    case_id: str,
    stage: str,
    payload: object,
    parent_hash: str | None = None,
    algo_versions: dict[str, object] | None = None,
    model_versions: dict[str, object] | None = None,
) -> str | None:
    try:
        snapshot = get_snapshot_store().append_snapshot(
            case_id=case_id,
            stage=stage,
            payload=payload,
            parent_hash=parent_hash,
            algo_versions=algo_versions,
            model_versions=model_versions,
        )
        return snapshot.payload_hash
    except Exception:
        # Snapshot persistence is additive and must not break API behavior.
        return parent_hash


def snapshot_cbam_compliance_pack(
    case_id: str, compliance_pack: object, parent_hash: str | None = None
) -> str | None:
    return _safe_snapshot_write(
        case_id=case_id,
        stage="compliance_pack_v1",
        payload=compliance_pack,
        parent_hash=parent_hash,
        algo_versions={"compliance_pack_builder": "v1"},
        model_versions={},
    )


def _document_sha256_from_extraction_snapshot(case_id: str) -> str | None:
    """Return the SHA-256 of the source document for this case.

    Prefers the ``document_sha256`` field written at upload time (hash of the
    raw binary file bytes). Falls back to ``sha256_hex(raw_text)`` for
    snapshots created before task #9 was implemented.
    """
    try:
        snapshot = get_snapshot_store().latest_snapshot_by_stage(case_id, "extraction_v1")
    except Exception:
        return None
    if snapshot is None:
        return None

    try:
        payload = json.loads(snapshot.payload_json)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None

    # Prefer the raw-bytes hash written at upload time (task #9).
    doc_sha256 = payload.get("document_sha256")
    if isinstance(doc_sha256, str) and doc_sha256:
        return doc_sha256

    # Legacy fallback: derive from extracted text.
    raw_text = payload.get("raw_text")
    if not isinstance(raw_text, str) or not raw_text:
        return None
    return sha256_hex(raw_text)


def _evidence_documents_from_snapshot(case_id: str) -> list[dict[str, object]]:
    """Build the evidence_documents list for the report package audit block.

    Returns a list of dicts, one per ingested source document, containing:
      - document_sha256: SHA-256 of the raw upload bytes (the immutable chain root)
      - filename: original filename if captured
      - ingested_at: ISO timestamp from the snapshot
      - snapshot_stage: e.g. "extraction_v1"
      - snapshot_hash: hash of the extraction snapshot payload

    Consumed by a third-party reviewer to verify source integrity without
    access to the platform database.
    """
    try:
        snapshot = get_snapshot_store().latest_snapshot_by_stage(case_id, "extraction_v1")
    except Exception:
        return []
    if snapshot is None:
        return []

    try:
        payload = json.loads(snapshot.payload_json)
    except Exception:
        return []
    if not isinstance(payload, dict):
        return []

    doc_sha256 = payload.get("document_sha256")
    if not doc_sha256:
        raw_text = payload.get("raw_text")
        doc_sha256 = sha256_hex(raw_text) if isinstance(raw_text, str) and raw_text else None

    return [
        {
            "document_sha256": doc_sha256,
            "filename": payload.get("filename"),
            "ingested_at": (
                snapshot.created_at
                if hasattr(snapshot, "created_at") and snapshot.created_at
                else None
            ),
            "snapshot_stage": "extraction_v1",
            "snapshot_hash": snapshot.payload_hash,
        }
    ]


def _extraction_evidence_summary(case_id: str) -> dict[str, object]:
    """Build the extraction_evidence block for the report package.

    Reads the arbitrated_v1 snapshot and returns:
      - snapshot_stage / snapshot_hash: chain reference
      - arbitrated_invoice_fields: the resolved invoice header values
      - goods_lines_count: how many line items were extracted
      - evidence_atoms: per-field evidence atoms so a third-party auditor can
        locate every value in the source document.

    Returns an empty dict (not an error) when no arbitrated snapshot exists yet.
    """
    try:
        snapshot = get_snapshot_store().latest_snapshot_by_stage(case_id, "arbitrated_v1")
    except Exception:
        return {}
    if snapshot is None:
        return {}

    try:
        payload = json.loads(snapshot.payload_json)
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}

    invoice = payload.get("invoice") or {}
    lines = payload.get("lines") or []
    raw_atoms = payload.get("evidence") or []

    atoms_out: list[dict[str, object]] = []
    for atom in raw_atoms:
        if not isinstance(atom, dict):
            continue
        clean: dict[str, object] = {
            "field": atom.get("field"),
            "value": atom.get("value"),
            "source": atom.get("source"),
        }
        if atom.get("page") is not None:
            clean["page"] = atom["page"]
        if atom.get("span") is not None:
            clean["span"] = atom["span"]
        if atom.get("bbox") is not None:
            clean["bbox"] = atom["bbox"]
        if atom.get("confidence") is not None:
            clean["confidence"] = atom["confidence"]
        if atom.get("snippet") is not None:
            clean["snippet"] = atom["snippet"]
        atoms_out.append(clean)

    return {
        "snapshot_stage": "arbitrated_v1",
        "snapshot_hash": snapshot.payload_hash,
        "arbitrated_invoice_fields": {
            "invoice_number": invoice.get("invoice_number"),
            "invoice_date": invoice.get("invoice_date"),
            "origin_country": invoice.get("origin_country"),
            "incoterm": invoice.get("incoterm"),
        },
        "goods_lines_count": len(lines),
        "evidence_atoms": atoms_out,
    }
