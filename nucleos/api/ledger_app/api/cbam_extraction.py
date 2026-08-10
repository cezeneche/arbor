"""Internal extraction endpoint: text in, structured CBAM fields out.

POST /internal/cbam/extract

The only extraction entry point after Phase 2. It takes text Arbor has already
extracted and returns drafts — never a provenance tier, which only a human
action in Arbor's Review screen can set.

Not browser-facing. Arbor calls it server-side; no document bytes cross the
boundary and nothing here can reach Arbor's database.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status

from ledger_app.contract.models import (
    CbamExtractionRequest,
    CbamExtractionResult,
    EngineVersions,
    EvidenceAtom,
    ExtractedFieldDraft,
    GoodsLineDraft,
)
from ledger_app.core.version import APP_VERSION
from ledger_app.services.cbam_emission_factors import FACTOR_METADATA
from ledger_app.services.text_ingest import run_text_ingest

from app.services.cbam_default_markup import MARKUP_TABLE_VERSION

_log = logging.getLogger("nucleos.cbam_extraction")

router = APIRouter(tags=["cbam-extraction"])

# Scalar fields the extractor produces, mapped to the dotted names the evidence
# atoms use. The dotted name is what a reviewer sees next to a source snippet.
_SCALAR_FIELDS: dict[str, str] = {
    "importer_name": "importer.name",
    "importer_eori": "importer.eori",
    "operator_name": "cbam.operator_name",
    "installation_name": "cbam.installation_name",
    "installation_id": "cbam.installation_id",
    "invoice_number": "invoice.invoice_number",
    "invoice_date": "invoice.invoice_date",
    "import_date": "invoice.import_date",
    "origin_country": "invoice.origin_country",
    "incoterm": "invoice.incoterm",
    "entry_reference": "invoice.entry_reference",
    "production_route": "cbam.production_route",
    "carbon_price_paid_eur": "cbam.carbon_price_paid_eur",
    "carbon_price_paid_currency": "cbam.carbon_price_paid_currency",
}


def _evidence_for(evidence: list[dict], field: str) -> list[EvidenceAtom]:
    atoms: list[EvidenceAtom] = []
    for raw in evidence or []:
        if not isinstance(raw, dict) or raw.get("field") != field:
            continue
        span = raw.get("span")
        atoms.append(
            EvidenceAtom(
                field=str(raw.get("field") or field),
                value=raw.get("value"),
                source=str(raw.get("source") or "unknown"),
                confidence=float(raw.get("confidence") or 0.0),
                snippet=raw.get("snippet"),
                page=raw.get("page"),
                span=span if isinstance(span, dict) else None,
            )
        )
    return atoms


def _confidence_of(atoms: list[EvidenceAtom]) -> float:
    return max((a.confidence for a in atoms), default=0.0)


def _extractor_of(atoms: list[EvidenceAtom]) -> str | None:
    return atoms[0].source if atoms else None


@router.post(
    "/internal/cbam/extract",
    response_model=CbamExtractionResult,
    status_code=status.HTTP_200_OK,
)
def extract_cbam_from_text(payload: CbamExtractionRequest) -> CbamExtractionResult:
    """Run the CBAM extraction chain over already-extracted text.

    Fails closed. A CBAM extraction that cannot complete returns an error, never
    an empty result: an empty extraction is indistinguishable from a document
    that genuinely contained nothing, and a reviewer would confirm the second
    while looking at the first.
    """
    try:
        ingested = run_text_ingest(
            payload.text,
            pages=[p.model_dump() for p in payload.pages] if payload.pages else None,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    candidate = ingested["candidate"]
    evidence = candidate.get("evidence") or []
    structured = candidate.get("structured") or {}

    flags: list[str] = []
    # Verbatim, in the order the stages ran. These strings are the
    # anti-hallucination signal a reviewer acts on; never summarised in transit.
    flags.extend(str(f) for f in (candidate.get("flags") or []))
    flags.extend(f"arbiter_conflict:{w}" if not str(w).startswith("arbiter") else str(w)
                 for w in ingested["arbiter_warnings"])
    flags.extend(f"repair_failed:{w}" if not str(w).startswith("repair") else str(w)
                 for w in ingested["repair_warnings"])

    if payload.ocr_quality and payload.ocr_quality.truncated:
        # Arbor already flags this to the reviewer; carrying it here means the
        # extraction result itself records that it saw only part of the source.
        reason = payload.ocr_quality.truncation_reason or "reason not recorded"
        flags.append(f"source_truncated:{reason}")

    fields: list[ExtractedFieldDraft] = []
    for key, dotted in _SCALAR_FIELDS.items():
        value = structured.get(key)
        atoms = _evidence_for(evidence, dotted)
        if value is None and not atoms:
            continue
        fields.append(
            ExtractedFieldDraft(
                field_name=key,
                raw_value=None if value is None else str(value),
                raw_unit=None,
                source_text=atoms[0].snippet if atoms else None,
                confidence=_confidence_of(atoms),
                extractor=_extractor_of(atoms),
                flags=[],
                evidence=atoms,
            )
        )

    lines: list[GoodsLineDraft] = []
    for index, line in enumerate(candidate.get("lines") or []):
        if not isinstance(line, dict):
            continue
        method = line.get("method")
        lines.append(
            GoodsLineDraft(
                line_index=index,
                cn_code=line.get("cn_code"),
                description=line.get("description"),
                net_mass_kg=line.get("net_mass_kg"),
                origin_country=line.get("origin_country") or structured.get("origin_country"),
                production_route=line.get("production_route"),
                installation_id=line.get("installation_id"),
                installation_name=line.get("installation_name"),
                direct_embedded_kgco2e=line.get("direct_embedded_kgco2e"),
                indirect_embedded_kgco2e=line.get("indirect_embedded_kgco2e"),
                emissions_method=str(method).upper() if method else None,
                flags=[],
            )
        )

    return CbamExtractionResult(
        document_id=payload.document_id,
        document_class=ingested.get("document_class"),
        fields=fields,
        lines=lines,
        flags=flags,
        engine=EngineVersions(
            engine_version=APP_VERSION,
            annex_vi_factor_version=str(FACTOR_METADATA.get("table_version") or ""),
            markup_table_version=MARKUP_TABLE_VERSION,
            regulation_reference="Commission Implementing Regulation (EU) 2023/1773",
        ),
    )
