"""Layout parsing and evidence atom construction for CBAM document extraction.

Evidence atoms link every extracted value back to the exact location in the
source document (page, span, bounding box, snippet) so a third-party auditor
can verify each value without access to the platform database.
"""
from __future__ import annotations

import re
from typing import Any

from ledger_app.schemas.evidence import EvidenceAtom, EvidenceBBox, EvidenceSpan


def _layout_text(layout: dict[str, Any] | None, zone: str) -> str:
    if not isinstance(layout, dict):
        return ""

    direct_value = layout.get(zone)
    if isinstance(direct_value, str):
        return direct_value.strip()
    if isinstance(direct_value, list):
        joined = " ".join(
            str(item.get("text", "")).strip() if isinstance(item, dict) else str(item).strip()
            for item in direct_value
        ).strip()
        if joined:
            return joined

    blocks = layout.get("blocks")
    if isinstance(blocks, list):
        zone_text = " ".join(
            str(block.get("text", "")).strip()
            for block in blocks
            if isinstance(block, dict) and str(block.get("type", "")).strip().lower() == zone
        ).strip()
        if zone_text:
            return zone_text

    if zone in {"full", "full_text", "raw_text"}:
        fallback = layout.get("full_text") or layout.get("raw_text")
        if isinstance(fallback, str):
            return fallback.strip()

    return ""


def _snippet_from_span(text: str, start: int, end: int, radius: int = 40) -> str:
    safe_start = max(start, 0)
    safe_end = max(end, safe_start)
    left = max(0, safe_start - radius)
    right = min(len(text), safe_end + radius)
    return text[left:right].strip()


def _normalize_token(value: str) -> str:
    return re.sub(r"[^a-z0-9\-_\/]", "", value.lower())


def _find_page_bbox_for_value(
    pages: list[dict[str, Any]] | None,
    value: Any,
) -> tuple[int | None, dict[str, float] | None]:
    if not isinstance(pages, list) or value in (None, ""):
        return None, None

    target = _normalize_token(str(value))
    if not target:
        return None, None

    for page in pages:
        if not isinstance(page, dict):
            continue
        page_number = page.get("page_number")
        words = page.get("words")
        if not isinstance(words, list):
            continue
        for word in words:
            if not isinstance(word, dict):
                continue
            token = _normalize_token(str(word.get("text", "")))
            if not token:
                continue
            if token == target or target in token or token in target:
                try:
                    bbox = {
                        "x0": float(word.get("x0")),
                        "y0": float(word.get("y0")),
                        "x1": float(word.get("x1")),
                        "y1": float(word.get("y1")),
                    }
                except (TypeError, ValueError):
                    bbox = None
                return int(page_number) if page_number is not None else None, bbox
    return None, None


def _append_evidence_atom(
    evidence: list[dict[str, Any]] | None,
    *,
    field: str,
    value: Any,
    source: str,
    text: str | None = None,
    start: int | None = None,
    end: int | None = None,
    page: int | None = None,
    bbox: dict[str, float] | None = None,
    confidence: float | None = None,
    snippet: str | None = None,
) -> None:
    if evidence is None or value in (None, ""):
        return

    span = None
    if start is not None and end is not None:
        span = EvidenceSpan(start=max(start, 0), end=max(end, max(start, 0)))

    bbox_model = None
    if isinstance(bbox, dict):
        try:
            bbox_model = EvidenceBBox(
                x0=float(bbox.get("x0")),
                y0=float(bbox.get("y0")),
                x1=float(bbox.get("x1")),
                y1=float(bbox.get("y1")),
            )
        except (TypeError, ValueError):
            bbox_model = None

    snippet_value = snippet
    if snippet_value is None and text is not None and span is not None:
        snippet_value = _snippet_from_span(text, span.start, span.end)

    atom = EvidenceAtom(
        field=field,
        value=value,
        source=source,
        page=page,
        span=span,
        bbox=bbox_model,
        confidence=confidence,
        snippet=snippet_value,
    )
    evidence.append(atom.model_dump(mode="json"))


def _append_regex_evidence(
    evidence: list[dict[str, Any]] | None,
    *,
    field: str,
    value: Any,
    source_text: str,
    match: re.Match[str],
    group_index: int = 1,
    source: str = "rule_regex",
    confidence: float = 0.96,
    pages: list[dict[str, Any]] | None = None,
) -> None:
    if evidence is None:
        return

    try:
        start = match.start(group_index)
        end = match.end(group_index)
    except IndexError:
        start = match.start(0)
        end = match.end(0)

    page, bbox = _find_page_bbox_for_value(pages, value)
    _append_evidence_atom(
        evidence,
        field=field,
        value=value,
        source=source,
        text=source_text,
        start=start,
        end=end,
        page=page,
        bbox=bbox,
        confidence=confidence,
    )


def _has_evidence_for_field(evidence: list[dict[str, Any]] | None, field: str) -> bool:
    if not isinstance(evidence, list):
        return False
    for atom in evidence:
        if isinstance(atom, dict) and atom.get("field") == field:
            return True
    return False


def _ensure_value_evidence(
    evidence: list[dict[str, Any]] | None,
    *,
    field: str,
    value: Any,
    text: str,
    source: str,
    pages: list[dict[str, Any]] | None = None,
) -> None:
    if evidence is None or value in (None, "") or _has_evidence_for_field(evidence, field):
        return
    target = str(value).strip()
    if not target:
        return

    match = re.search(re.escape(target), text, flags=re.IGNORECASE)
    if not match:
        return

    page, bbox = _find_page_bbox_for_value(pages, value)
    _append_evidence_atom(
        evidence,
        field=field,
        value=value,
        source=source,
        text=text,
        start=match.start(0),
        end=match.end(0),
        page=page,
        bbox=bbox,
        confidence=0.85,
    )
