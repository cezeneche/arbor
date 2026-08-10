"""Run the CBAM extraction chain over text Arbor has already extracted.

This is the same chain the upload pipeline ran — extractor, then arbiter, then
repair — with the document-to-text step removed. Arbor owns that step from
Phase 2, so the bytes never arrive here.

The chain itself is unchanged. Nothing in this module reinterprets, filters or
re-scores what the extractor, arbiter and repair layers produce; it marshals
text in and their output back out. Any behavioural difference between this path
and the upload path it replaces is a bug in this module.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from ledger_app.services.cbam_arbiter import arbitrate_parsed_invoice
from ledger_app.services.cbam_customs_parser import (
    is_customs_declaration,
    parse_customs_declaration,
)
from ledger_app.services.cbam_extractor import extract as extract_cbam_document
from ledger_app.services.cbam_mill_cert_parser import (
    is_mill_certificate,
    parse_mill_certificate,
)
from ledger_app.services.cbam_repair import repair_parsed_invoice
from ledger_app.services.cbam_spreadsheet_parser import parse_csv
from ledger_app.services.cbam_xml_declaration_parser import parse_cbam_xml_declaration

__all__ = ["IngestedText", "run_text_ingest"]


class IngestedText(dict):
    """Result of running the chain over one document's text.

    A dict subclass so callers that already handle the upload pipeline's plan
    shape keep working during the migration.
    """


def _extract_with_optional_kwargs(
    path: str,
    layout: dict[str, Any] | None,
    pages: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Call the extractor, tolerating the older signatures still in the tree.

    The upload pipeline did the same. Keeping it means this path and the one it
    replaces call the extractor identically, which is the point.
    """
    try:
        return extract_cbam_document(path, layout=layout, pages=pages)
    except TypeError:
        try:
            return extract_cbam_document(path, layout=layout)
        except TypeError:
            return extract_cbam_document(path)


def _looks_like_xml(text: str) -> bool:
    stripped = text.lstrip()
    return stripped.startswith("<?xml") or stripped.startswith("<")


def _looks_like_csv(text: str) -> bool:
    """A first line of comma-separated headers the spreadsheet parser recognises.

    Deliberately stricter than "contains commas": prose contains commas, and a
    false positive here sends an invoice through a parser that returns nothing.
    """
    from ledger_app.services.cbam_spreadsheet_parser import _map_headers  # noqa: PLC0415

    first_line = text.lstrip().split("\n", 1)[0]
    if "," not in first_line:
        return False
    headers = [h.strip() for h in first_line.split(",")]
    return len(_map_headers(headers)) >= 2


def _specialist_candidates(
    text: str,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[str], list[str], bool]:
    """Run whichever specialist parsers recognise this text.

    Returns (candidates, supplementary, parsers_applied, flags, authoritative).

    Two kinds of parser, and the distinction decides whether the deterministic
    regex layer still gets a vote:

    * FORMAT parsers — XML and CSV. The input is structured, and the regex layer
      has no business reading it. Left to compete, it reads
      ``<netMassTonnes>24.500</netMassTonnes>`` as 24.5 kilograms and the
      arbiter has no way to know that is a thousand-fold error. When a format
      parser succeeds it is authoritative and stands alone.

    * TEXT parsers — the customs declaration. It reads the same prose the regex
      layer reads, using box numbers instead of keywords. Genuine disagreement
      between two readings of the same text is exactly what the arbiter is for,
      so it enters as an additional candidate.

    The mill certificate produces a supplementary dict with no invoice or goods
    lines — its own docstring says to merge it rather than treat it as a parse —
    so it attaches alongside instead of competing.

    A parser that raises is flagged and skipped. One malformed file must not cost
    the extraction the answer the deterministic layer already has.
    """
    candidates: list[dict[str, Any]] = []
    supplementary: dict[str, Any] | None = None
    applied: list[str] = []
    flags: list[str] = []
    authoritative = False

    def _try(name: str, fn: Any) -> Any:
        try:
            return fn()
        except Exception as exc:
            flags.append(f"parser_failed:{name}:{type(exc).__name__}: {exc}")
            return None

    if _looks_like_xml(text):
        parsed = _try("xml_declaration_parser", lambda: parse_cbam_xml_declaration(text.encode("utf-8")))
        if parsed:
            parsed["source"] = "xml_declaration_parser"
            candidates.append(parsed)
            applied.append("xml_declaration_parser")
            authoritative = True

    elif _looks_like_csv(text):
        parsed = _try("spreadsheet_parser", lambda: parse_csv(text.encode("utf-8")))
        if parsed:
            parsed["source"] = "spreadsheet_parser"
            candidates.append(parsed)
            applied.append("spreadsheet_parser")
            authoritative = True

    if is_customs_declaration(text):
        parsed = _try("customs_parser", lambda: parse_customs_declaration(text))
        if parsed:
            parsed["source"] = "customs_parser"
            candidates.append(parsed)
            applied.append("customs_parser")

    if is_mill_certificate(text):
        parsed = _try("mill_cert_parser", lambda: parse_mill_certificate(text))
        if parsed:
            supplementary = parsed
            applied.append("mill_cert_parser")

    return candidates, supplementary, applied, flags, authoritative


def run_text_ingest(
    raw_text: str,
    pages: list[dict[str, Any]] | None = None,
    layout: dict[str, Any] | None = None,
) -> IngestedText:
    """Extract, arbitrate and repair a document's text.

    Returns the repaired candidate together with the warnings each stage
    produced, kept separate so a caller can attribute a flag to the stage that
    raised it.

    Raises
    ------
    ValueError
        When the extractor cannot produce a usable result. Callers surface this
        as a failure rather than an empty extraction: a CBAM extraction that
        silently returns nothing is indistinguishable from a document with
        nothing in it.
    """
    text = raw_text or ""
    safe_pages = pages if isinstance(pages, list) else None

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix="cbam_text_", suffix=".txt", delete=False
        ) as tmp:
            tmp_path = Path(tmp.name)
            tmp.write(text.encode("utf-8"))

        extraction = _extract_with_optional_kwargs(str(tmp_path), layout, safe_pages)
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)

    if not isinstance(extraction, dict):
        raise ValueError("Extractor returned an invalid response.")

    status = extraction.get("status")
    if status in {"error", "not_implemented"}:
        raise ValueError(str(extraction.get("message") or f"Extraction status: {status}"))

    candidate = dict(extraction)
    candidate["source"] = "rule"
    candidate["layout"] = layout
    candidate["full_text"] = text
    if not isinstance(candidate.get("evidence"), list):
        candidate["evidence"] = []

    specialist, supplementary, parsers_applied, parser_flags, authoritative = _specialist_candidates(text)
    for parsed in specialist:
        parsed.setdefault("full_text", text)
        if not isinstance(parsed.get("evidence"), list):
            parsed["evidence"] = []

    # A format parser stands alone. Otherwise specialists lead and the generic
    # regex candidate trails as the fallback: on a document the customs parser
    # recognises, reading Box 7 for the MRN beats hunting for the word "invoice"
    # in prose, and the generic layer returning None for a field the specialist
    # found must not win by being listed first.
    to_arbitrate = specialist if authoritative else [*specialist, candidate]
    arbitrated, arbiter_warnings = arbitrate_parsed_invoice(to_arbitrate)
    repaired, repair_warnings = repair_parsed_invoice(arbitrated)

    return IngestedText(
        {
            "candidate": repaired,
            "supplementary": supplementary,
            "parsers_applied": parsers_applied,
            "parser_flags": parser_flags,
            "arbiter_warnings": arbiter_warnings,
            "repair_warnings": repair_warnings,
            "extractor": extraction.get("extractor"),
            "document_class": extraction.get("document_type"),
        }
    )
