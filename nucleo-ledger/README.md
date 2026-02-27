# núcleo

núcleo ledger — deterministic carbon calculation engine with audit traceability.

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
