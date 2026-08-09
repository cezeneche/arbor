"""ClaudeCBAMExtractor: deterministic-first hybrid extraction with Claude gap-fill.

Architecture:
  1. Regex always runs first and is the primary source of truth.
  2. Claude is called once to fill fields regex could not find.
     A Claude value is accepted only when it passes field validation AND
     its string representation appears literally in raw_text.
  3. No valid deterministic value is ever overridden.
  4. Claude line items are merged only when deterministic extraction found zero
     lines, and only after CN-code and positive-mass validation with evidence.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Callable, Protocol

from ._validators import (
    _FIELD_VALIDATOR_REASONS,
    _FIELD_VALIDATORS,
    _normalize_method,
    _parse_number,
    _valid_cn_code,
    _valid_mass,
    _validate_deterministic_fields,
    _value_in_text,
)
from ._evidence import _ensure_value_evidence
from ._regex import (
    _build_extraction_payload,
    _parse_structured_response,
)

_logger = logging.getLogger("ledger.cbam_extractor")


class CBAMExtractor(Protocol):
    def extract(
        self,
        file_path: str,
        layout: dict[str, Any] | None = None,
        pages: list[dict[str, Any]] | None = None,
    ) -> dict:
        ...


def _parse_claude_json_only(raw: str) -> dict[str, Any]:
    """Parse raw Claude output as JSON only; no regex fallbacks."""
    try:
        loaded = json.loads(raw)
        if isinstance(loaded, dict):
            return loaded
    except Exception:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end > start:
        try:
            loaded = json.loads(raw[start: end + 1])
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            pass
    return {}


# Normalisation callables for each scalar field Claude may return.
_CLAUDE_SCALAR_NORMALISERS: dict[str, Callable[[Any], Any]] = {
    "importer_name": lambda v: str(v).strip() or None,
    "importer_eori": lambda v: str(v).strip().upper() or None,
    "invoice_number": lambda v: str(v).strip() or None,
    "invoice_date": lambda v: str(v).strip() or None,
    "origin_country": lambda v: str(v).strip().upper() or None,
    "incoterm": lambda v: str(v).strip().upper() or None,
    "entry_reference": lambda v: str(v).strip() or None,
    "method": lambda v: _normalize_method(str(v)),
    "net_mass_kg": lambda v: _parse_number(str(v)),
    "direct_embedded_kgco2e": lambda v: _parse_number(str(v)),
    "indirect_embedded_kgco2e": lambda v: _parse_number(str(v)),
    "operator_name": lambda v: str(v).strip() or None,
    "installation_name": lambda v: str(v).strip() or None,
    "installation_id": lambda v: str(v).strip().upper() or None,
    "production_route": lambda v: str(v).strip() or None,
    "import_date": lambda v: str(v).strip() or None,
    "carbon_price_paid_eur": lambda v: _parse_number(str(v)),
    "carbon_price_paid_currency": lambda v: str(v).strip().upper() or None,
}


def _merge_claude_scalar_fields(
    det: dict[str, Any],
    claude: dict[str, Any],
    raw_text: str,
    flags: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    pages: list[dict[str, Any]] | None,
) -> None:
    """Apply deterministic-first merge rules for all scalar header fields.

    Rules (applied per field, in order):
    1. Valid deterministic value present → keep it; if Claude differs, log flag.
    2. Deterministic value absent → accept Claude's value only when:
       a. It passes the field validator (if one exists).
       b. The value appears literally in raw_text (evidence requirement).
    No valid deterministic value is ever overridden.
    """
    for field, normalise in _CLAUDE_SCALAR_NORMALISERS.items():
        raw_claude_val = claude.get(field)
        if raw_claude_val is None:
            continue
        claude_val = normalise(raw_claude_val)
        if claude_val is None:
            continue

        det_val = det.get(field)
        if det_val is not None:
            if claude_val != det_val:
                flags.append(
                    {
                        "field": field,
                        "issue": "claude_conflict_ignored",
                        "deterministic_value": det_val,
                        "claude_value": claude_val,
                    }
                )
            continue

        validator = _FIELD_VALIDATORS.get(field)
        if validator and not validator(claude_val):
            flags.append(
                {
                    "field": field,
                    "issue": "claude_value_failed_validation",
                    "value": claude_val,
                    "reason": _FIELD_VALIDATOR_REASONS.get(field, ""),
                    "source": "claude",
                }
            )
            continue

        if not _value_in_text(claude_val, raw_text):
            flags.append(
                {
                    "field": field,
                    "issue": "claude_value_not_evidenced_in_text",
                    "value": claude_val,
                    "source": "claude",
                }
            )
            continue

        det[field] = claude_val
        _ensure_value_evidence(
            evidence,
            field=field,
            value=claude_val,
            text=raw_text,
            source="claude_validated",
            pages=pages,
        )


class ClaudeCBAMExtractor:
    """Production CBAM invoice extractor using Anthropic Claude.

    Implements a deterministic-first hybrid architecture:

    1. Regex/structured parsing always runs first and is the primary source of
       truth.  Every extracted value is validated (incoterm whitelist, ISO-2,
       EORI regex, 6-8 digit CN code, positive numeric mass, YYYY-MM-DD date).
    2. Claude is called once (when ``ANTHROPIC_API_KEY`` is set) to fill
       fields that regex could not find.  A Claude value is accepted only when:
       a. It passes the same field validator.
       b. Its string representation appears literally in ``raw_text``
          (evidence requirement).
    3. No valid deterministic value is ever overridden.  All conflicts and
       rejected Claude suggestions are recorded in the top-level ``flags``
       array of the returned payload.
    4. Line items from Claude are merged only when deterministic extraction
       found zero lines, and only after each line passes CN-code and
       positive-mass validation with evidence in ``raw_text``.
    5. Output is fully deterministic across runs (no stochastic post-
       processing; Claude's role is purely gap-filling after strict
       validation).

    Falls back to regex-only extraction when ``ANTHROPIC_API_KEY`` is absent
    or the API call fails.

    Environment variables
    ---------------------
    ANTHROPIC_API_KEY       Required for live extraction.
    CBAM_EXTRACTOR_MODEL    Claude model ID to use.
                            Defaults to ``claude-haiku-4-5-20251001``.
    """

    _PROMPT = (
        "You are a CBAM (Carbon Border Adjustment Mechanism) compliance specialist.\n"
        "Extract structured data from the invoice/document text below.\n\n"
        "Return ONLY a valid JSON object with this exact structure "
        "(use null for any field not found):\n"
        "{\n"
        '  "importer_name": string | null,\n'
        '  "importer_eori": "EU EORI number: 2-letter country code + digits" | null,\n'
        '  "operator_name": "name of the exporting operator or supplier" | null,\n'
        '  "installation_name": "name of the production installation" | null,\n'
        '  "installation_id": "installation registry ID e.g. DE_12345678" | null,\n'
        '  "invoice_number": string | null,\n'
        '  "invoice_date": "YYYY-MM-DD" | null,\n'
        '  "import_date": "YYYY-MM-DD date goods entered customs / arrived" | null,\n'
        '  "origin_country": "ISO-3166-1 alpha-2 code of goods origin" | null,\n'
        '  "incoterm": "3-letter Incoterm e.g. CIF FOB DAP" | null,\n'
        '  "entry_reference": "customs entry / MRN reference" | null,\n'
        '  "production_route": "production route e.g. BF_BOF EAF DRI natural_gas" | null,\n'
        '  "carbon_price_paid_eur": "carbon tax or ETS cost already paid in origin country (EUR/tonne CO2e)" | null,\n'
        '  "carbon_price_paid_currency": "3-letter ISO currency code if not EUR" | null,\n'
        '  "lines": [\n'
        '    {\n'
        '      "cn_code": "6-8 digit EU Combined Nomenclature code" | null,\n'
        '      "description": string | null,\n'
        '      "net_mass_kg": number | null,\n'
        '      "direct_embedded_kgco2e": number | null,\n'
        '      "indirect_embedded_kgco2e": number | null,\n'
        '      "method": "actual" | "default" | "estimated" | null,\n'
        '      "installation_id": "installation registry ID for this line" | null,\n'
        '      "installation_name": "installation name for this line" | null,\n'
        '      "production_route": "production route for this line" | null\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- CN codes must be 6-8 digit numeric EU Combined Nomenclature codes.\n"
        "- method must be exactly one of: actual, default, estimated (or null).\n"
        "- carbon_price_paid_eur is a number (e.g. 25.5), not a string.\n"
        "- Do not include any text, markdown or explanation outside the JSON.\n\n"
        "Document text:\n{document_text}"
    )

    def __init__(self, model: str | None = None) -> None:
        self.model = model or os.getenv(
            "CBAM_EXTRACTOR_MODEL", "claude-haiku-4-5-20251001"
        )

    def _call_claude(self, document_text: str) -> str:
        import anthropic  # lazy import; fails gracefully if not installed

        client = anthropic.Anthropic(timeout=25.0)
        message = client.messages.create(
            model=self.model,
            max_tokens=1500,
            messages=[
                {
                    "role": "user",
                    "content": self._PROMPT.replace(
                        "{document_text}", document_text[:6000]
                    ),
                }
            ],
        )
        return message.content[0].text

    def _merge_claude_lines(
        self,
        payload: dict[str, Any],
        claude_json: dict[str, Any],
        evidence: list[dict[str, Any]],
        raw_text: str,
        flags: list[dict[str, Any]],
        pages: list[dict[str, Any]] | None,
    ) -> None:
        """Add validated Claude line items the deterministic layer did not find.

        Each candidate line must pass CN-code validation, positive-mass
        validation, and have both values evidenced in ``raw_text``.  Rejected
        lines are recorded in ``flags``.

        Deterministic lines are never modified — that invariant is what makes
        the hybrid trustworthy — but they no longer suppress the rest of the
        document.  This used to return early whenever the deterministic layer
        found any line at all, so a two-line invoice where regex caught only the
        first silently declared half the goods.  A short declaration looks
        exactly like a complete one, so nothing downstream could catch it.

        Every addition and every disagreement about line count is flagged: two
        extractors reading a different number of goods lines out of the same
        document is something a reviewer needs told, whichever one is right.
        """
        claude_lines = claude_json.get("lines")
        if not isinstance(claude_lines, list):
            return

        existing: list[dict[str, Any]] = list(payload.get("lines") or [])
        existing_pairs = {
            (str(line.get("cn_code") or ""), _parse_number(str(line.get("net_mass_kg"))))
            for line in existing
        }
        existing_codes = {str(line.get("cn_code") or "") for line in existing}

        lines: list[dict[str, Any]] = list(existing)
        for i, cl in enumerate(claude_lines):
            if not isinstance(cl, dict):
                continue

            cn_code = cl.get("cn_code")
            if not cn_code:
                flags.append(
                    {"issue": "claude_line_missing_cn_code", "line_index": i, "source": "claude"}
                )
                continue
            cn_code = str(cn_code).strip()
            if not _valid_cn_code(cn_code):
                flags.append(
                    {"issue": "claude_line_invalid_cn_code", "line_index": i,
                     "value": cn_code, "source": "claude"}
                )
                continue
            if not _value_in_text(cn_code, raw_text):
                flags.append(
                    {"issue": "claude_line_cn_code_not_evidenced", "line_index": i,
                     "value": cn_code, "source": "claude"}
                )
                continue

            mass = (
                _parse_number(str(cl["net_mass_kg"]))
                if cl.get("net_mass_kg") is not None
                else None
            )
            if not _valid_mass(mass):
                flags.append(
                    {"issue": "claude_line_invalid_mass", "line_index": i,
                     "value": mass, "source": "claude"}
                )
                continue
            if not _value_in_text(mass, raw_text):
                flags.append(
                    {"issue": "claude_line_mass_not_evidenced", "line_index": i,
                     "value": mass, "source": "claude"}
                )
                continue

            if (cn_code, mass) in existing_pairs:
                continue  # the deterministic layer already has this line

            if cn_code in existing_codes:
                # Either a second consignment of the same product or the two
                # extractors disagreeing about its mass. Both need a human.
                flags.append(
                    {"issue": "claude_line_same_cn_different_mass", "line_index": i,
                     "value": cn_code, "mass": mass, "source": "claude"}
                )
            else:
                flags.append(
                    {"issue": "claude_line_added_beyond_deterministic", "line_index": i,
                     "value": cn_code, "mass": mass, "source": "claude"}
                )

            line: dict[str, Any] = {
                "cn_code": cn_code,
                "description": cl.get("description"),
                "quantity": mass,
                "quantity_unit": "kg",
                "net_mass_kg": mass,
                "direct_embedded_kgco2e": (
                    _parse_number(str(cl["direct_embedded_kgco2e"]))
                    if cl.get("direct_embedded_kgco2e") is not None else None
                ),
                "indirect_embedded_kgco2e": (
                    _parse_number(str(cl["indirect_embedded_kgco2e"]))
                    if cl.get("indirect_embedded_kgco2e") is not None else None
                ),
                "method": _normalize_method(cl.get("method")),
                "installation_id": (
                    str(cl["installation_id"]).strip().upper()
                    if cl.get("installation_id") else None
                ),
                "installation_name": (
                    str(cl["installation_name"]).strip()
                    if cl.get("installation_name") else None
                ),
                "production_route": (
                    str(cl["production_route"]).strip()
                    if cl.get("production_route") else None
                ),
            }
            lines.append(line)
            _ensure_value_evidence(
                evidence,
                # Index into the merged list, not Claude's — the two diverge as
                # soon as a deterministic line is kept ahead of an added one.
                field=f"lines[{len(lines) - 1}].cn_code",
                value=cn_code,
                text=raw_text,
                source="claude_validated",
                pages=pages,
            )

        claude_line_count = sum(1 for cl in claude_lines if isinstance(cl, dict))
        if existing and claude_line_count != len(existing):
            flags.append(
                {"issue": "line_count_disagreement",
                 "deterministic_lines": len(existing),
                 "claude_lines": claude_line_count,
                 "source": "claude"}
            )

        if lines:
            payload["lines"] = lines

    def extract(
        self,
        file_path: str,
        layout: dict[str, Any] | None = None,
        pages: list[dict[str, Any]] | None = None,
    ) -> dict:
        path = Path(file_path)
        if not path.exists():
            return {"status": "error", "message": f"File not found: {file_path}"}

        evidence: list[dict[str, Any]] = []
        flags: list[dict[str, Any]] = []

        # ── 1. Load document text (LlamaIndex handles PDF / DOCX / TXT) ──────
        from ._regex import _read_raw_text

        raw_text = ""
        try:
            from llama_index.core import SimpleDirectoryReader

            documents = SimpleDirectoryReader(input_files=[str(path)]).load_data()
            raw_text = "\n\n".join(
                (getattr(doc, "text", "") or "").strip() for doc in documents
            ).strip()
        except Exception:
            pass
        if not raw_text:
            candidate = _read_raw_text(path)
            # Reject binary content — a PDF read as plain text is not usable.
            printable = sum(1 for c in candidate[:200] if c.isprintable())
            if len(candidate) > 0 and printable / max(len(candidate[:200]), 1) > 0.8:
                raw_text = candidate

        # ── 2. Deterministic (regex-first) extraction — always the primary source
        det_structured = _parse_structured_response(
            "{}",
            raw_text,
            layout=layout,
            evidence=evidence,
            pages=pages,
        )

        # ── 3. Validate all deterministic fields; clear invalids, record flags
        _validate_deterministic_fields(det_structured, flags)

        # ── 4. Claude gap-filling (one API call, scalar fields then lines) ────
        api_key = os.getenv("ANTHROPIC_API_KEY")
        extractor_tag = "regex"
        claude_json: dict[str, Any] = {}

        if api_key and raw_text:
            try:
                response_text = self._call_claude(raw_text)
                claude_json = _parse_claude_json_only(response_text)
                _merge_claude_scalar_fields(
                    det_structured, claude_json, raw_text, flags, evidence, pages
                )
                extractor_tag = f"claude:{self.model}"
            except Exception as exc:
                _logger.warning(
                    "cbam_extractor: claude_api_call_failed model=%s error=%s",
                    self.model,
                    str(exc),
                )
                flags.append({"issue": "claude_api_call_failed", "source": "claude"})

        # ── 5. Build payload from the merged deterministic result ─────────────
        payload = _build_extraction_payload(
            raw_text,
            det_structured,
            layout=layout,
            evidence=evidence,
            pages=pages,
            flags=flags,
        )

        # ── 6. Merge Claude lines only when deterministic found none ──────────
        if not payload.get("lines") and claude_json:
            self._merge_claude_lines(payload, claude_json, evidence, raw_text, flags, pages)

        payload["extractor"] = extractor_tag
        if extractor_tag == "regex":
            payload["fallback"] = "regex_only"
        return payload
