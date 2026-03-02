# nucleo-narrative

## Environment

From repo root:

```bash
cp .env.example .env
```

Core boot requirement:
- `LEDGER_URL` (or `LEDGER_BASE_URL`)

Optional provider keys:
- `OPENAI_API_KEY` (required only for OpenAI draft stage)
- `ANTHROPIC_API_KEY` (Claude review skipped if missing)
- `GEMINI_API_KEY` (Gemini gate skipped if missing)

## Run Services

Start `nucleo-ledger`:

```bash
cd nucleo-ledger
./venv/bin/uvicorn ledger_app.main:app --host 127.0.0.1 --port 8000 --reload
```

Start `nucleo-narrative`:

```bash
cd nucleo-narrative
./venv/bin/uvicorn narrative_app.main:app --host 127.0.0.1 --port 8001 --reload
```

## CBAM Compliance Pack

Generate a CBAM compliance pack:

```bash
curl -sS -X POST "http://127.0.0.1:8001/api/cbam/cases/<CASE_ID>/compliance-pack" | python3 -m json.tool
```

The endpoint fetches the ledger CBAM report package and runs the narrative pipeline to produce a `cbam_compliance_pack_v1`. OCR/vision quality depends on upstream extraction and may be best-effort in development tests.
