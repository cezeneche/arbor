# nucleo-narrative

## Run Services

Start `nucleo-ledger`:

```bash
cd nucleo-ledger
./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Start `nucleo-narrative`:

```bash
cd nucleo-narrative
./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

## CBAM Compliance Pack

Generate a CBAM compliance pack:

```bash
curl -sS -X POST "http://127.0.0.1:8001/api/cbam/cases/<CASE_ID>/compliance-pack" | python3 -m json.tool
```

The endpoint fetches the ledger CBAM report package and runs the narrative pipeline to produce a `cbam_compliance_pack_v1`. OCR/vision quality depends on upstream extraction and may be best-effort in development tests.
