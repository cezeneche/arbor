from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from pydantic import BaseModel
from pydantic import Field

_logger = logging.getLogger("ledger.structured_extractor")


class LineItemSchema(BaseModel):
    cn_code: str | None = None
    description: str | None = None
    quantity: float | None = None


class InvoiceSchema(BaseModel):
    importer_name: str | None = None
    invoice_number: str | None = None
    invoice_date: str | None = None
    origin_country: str | None = None
    line_items: list[LineItemSchema] = Field(default_factory=list)


def _empty_invoice() -> InvoiceSchema:
    return InvoiceSchema()


def extract_structured_invoice(full_text: str) -> InvoiceSchema:
    """Extract structured invoice fields via Claude gap-fill.

    EU 2023/1773 Art. 4 — only values literally present in source text are accepted.
    Returns null for absent fields; never invents values.
    """
    if not full_text.strip():
        return _empty_invoice()

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return _empty_invoice()

    try:
        import anthropic
    except ImportError:
        return _empty_invoice()

    prompt = (
        "Extract invoice fields from the text below. "
        "Return valid JSON only — no markdown fences, no explanation.\n"
        "Fields to extract:\n"
        "  importer_name: string or null\n"
        "  invoice_number: string or null\n"
        "  invoice_date: YYYY-MM-DD or null\n"
        "  origin_country: ISO 3166-1 alpha-2 or null\n"
        "  line_items: array of {cn_code, description, quantity} — empty array if none found\n"
        "Rules:\n"
        "- Only return values that appear literally in the source text.\n"
        "- Set a field to null if it is absent — never invent values.\n"
        "- cn_code must be 6–8 digits if present, otherwise null.\n"
        "- invoice_date must be in YYYY-MM-DD format if present, otherwise null.\n"
        "- origin_country must be a 2-letter ISO code if present, otherwise null.\n"
        "\nText:\n" + full_text[:8000]
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        model = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown fences if the model included them despite the instruction
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
        data = json.loads(raw)
        return InvoiceSchema.model_validate(data)
    except Exception as exc:
        _logger.debug("Claude extraction failed: %s", exc)
        return _empty_invoice()


def _rule_invoice_number(rule_output: dict[str, Any]) -> str | None:
    invoice = rule_output.get("invoice")
    if isinstance(invoice, dict):
        value = invoice.get("invoice_number")
        return str(value) if value is not None else None
    value = rule_output.get("invoice_number")
    return str(value) if value is not None else None


def _rule_invoice_date(rule_output: dict[str, Any]) -> str | None:
    invoice = rule_output.get("invoice")
    if isinstance(invoice, dict):
        value = invoice.get("invoice_date")
        return str(value) if value is not None else None
    value = rule_output.get("invoice_date")
    return str(value) if value is not None else None


def _rule_line_count(rule_output: dict[str, Any]) -> int:
    lines = rule_output.get("lines")
    if isinstance(lines, list):
        return len(lines)
    return 0


def _llama_to_invoice(llama_output: InvoiceSchema | dict[str, Any] | None) -> InvoiceSchema:
    if isinstance(llama_output, InvoiceSchema):
        return llama_output
    if isinstance(llama_output, dict):
        try:
            return InvoiceSchema.model_validate(llama_output)
        except Exception:
            return _empty_invoice()
    return _empty_invoice()


def compare_extractions(
    rule_output: dict[str, Any],
    llama_output: InvoiceSchema | dict[str, Any] | None,
) -> dict[str, Any]:
    invoice = _llama_to_invoice(llama_output)
    differences: list[str] = []

    checks = 0
    matches = 0

    checks += 1
    rule_invoice_number = _rule_invoice_number(rule_output)
    if rule_invoice_number == invoice.invoice_number:
        matches += 1
    else:
        differences.append(
            f"invoice_number mismatch: rule={rule_invoice_number!r}, claude={invoice.invoice_number!r}"
        )

    checks += 1
    rule_invoice_date = _rule_invoice_date(rule_output)
    if rule_invoice_date == invoice.invoice_date:
        matches += 1
    else:
        differences.append(f"invoice_date mismatch: rule={rule_invoice_date!r}, claude={invoice.invoice_date!r}")

    checks += 1
    rule_line_items = _rule_line_count(rule_output)
    claude_line_items = len(invoice.line_items)
    if rule_line_items == claude_line_items:
        matches += 1
    else:
        differences.append(f"line_items count mismatch: rule={rule_line_items}, claude={claude_line_items}")

    match_score = (matches / checks) * 100.0 if checks else 0.0
    return {"match_score": round(match_score, 2), "differences": differences}
