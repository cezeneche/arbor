# núcleo

núcleo ledger — deterministic carbon calculation engine with audit traceability.

## CBAM Document Upload

Upload a CBAM document (invoice image/PDF) for extraction:

```bash
curl -sS -X POST "http://127.0.0.1:8000/api/cbam/cases/<CASE_ID>/documents" \
  -F "file=@/path/to/invoice.pdf"
```
