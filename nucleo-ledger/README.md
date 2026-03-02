# núcleo

núcleo ledger — deterministic carbon calculation engine with audit traceability.

## Environment

From repo root:

```bash
cp .env.example .env
```

Core boot requirement:
- `DATABASE_URL`

Optional for storage endpoints:
- `S3_ENDPOINT_URL`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`

## CBAM Document Upload

Upload a CBAM document (invoice image/PDF) for extraction:

```bash
curl -sS -X POST "http://127.0.0.1:8000/api/cbam/cases/<CASE_ID>/documents" \
  -F "file=@/path/to/invoice.pdf"
```

## CBAM Drafts from Document

Create a CBAM draft directly from an uploaded invoice document:

```bash
curl -sS -X POST "http://127.0.0.1:8000/api/cbam/drafts/from-document" \
  -F "file=@/path/to/invoice.pdf" \
  -F "importer_name=Alpha Steel Ltd" \
  -F "importer_eori=GB123456789"
```

Optional form fields: `reporting_year`, `reporting_quarter`.
OCR/vision extraction is currently best-effort; tests may stub extraction for deterministic runs.

## Repair + Arbiter (Extraction Validation)

`POST /api/cbam/drafts/from-document` now runs a repair + arbitration pass before draft creation:
- `arbiter`: resolves field conflicts across extraction candidates (rule vs structured LLM).
- `repair`: fills only high-confidence missing fields from layout/text (no hallucinated values).

Common warning codes:
- `arbiter_conflict:<field>:<source_a>!=<source_b>`
- `repair_failed:<field>`
- `repair_failed:lines[<idx>].<field>`
- `dq_missing:<rule_code>`
- `dq_warning:<rule_code>`
