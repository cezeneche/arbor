from __future__ import annotations

import os
from typing import Any

from pydantic import BaseModel
from pydantic import Field


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
    """Extract structured invoice fields via LlamaIndex structured output."""
    if not full_text.strip():
        return _empty_invoice()

    try:
        from llama_index.core.program import LLMTextCompletionProgram
        from llama_index.core.prompts import PromptTemplate
        from llama_index.llms.openai import OpenAI
    except Exception:
        return _empty_invoice()

    if not os.getenv("OPENAI_API_KEY"):
        return _empty_invoice()

    prompt = PromptTemplate(
        "Extract invoice fields from the text below and return valid JSON only.\n"
        "Populate these fields: importer_name, invoice_number, invoice_date, origin_country, line_items[].\n"
        "For line_items, include cn_code, description, quantity.\n"
        "Text:\n{full_text}\n"
    )

    try:
        llm = OpenAI(model=os.getenv("LLAMA_STRUCTURED_MODEL", "gpt-4o-mini"), temperature=0)
        program = LLMTextCompletionProgram.from_defaults(
            llm=llm,
            output_cls=InvoiceSchema,
            prompt=prompt,
        )
        result = program(full_text=full_text)
        if isinstance(result, InvoiceSchema):
            return result
        if isinstance(result, BaseModel):
            return InvoiceSchema.model_validate(result.model_dump())
        if isinstance(result, dict):
            return InvoiceSchema.model_validate(result)
    except Exception:
        return _empty_invoice()

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
            f"invoice_number mismatch: rule={rule_invoice_number!r}, llama={invoice.invoice_number!r}"
        )

    checks += 1
    rule_invoice_date = _rule_invoice_date(rule_output)
    if rule_invoice_date == invoice.invoice_date:
        matches += 1
    else:
        differences.append(f"invoice_date mismatch: rule={rule_invoice_date!r}, llama={invoice.invoice_date!r}")

    checks += 1
    rule_line_items = _rule_line_count(rule_output)
    llama_line_items = len(invoice.line_items)
    if rule_line_items == llama_line_items:
        matches += 1
    else:
        differences.append(f"line_items count mismatch: rule={rule_line_items}, llama={llama_line_items}")

    match_score = (matches / checks) * 100.0 if checks else 0.0
    return {"match_score": round(match_score, 2), "differences": differences}
