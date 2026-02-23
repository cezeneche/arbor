# Scope 3 Agentic Platform

A lightweight monorepo for an **audit-ready** Scope 3 workflow:

- **nucleo-ledger**: stores cases, builds report packages (audit packs), runs calculations, and records conflict resolution.
- **nucleo-narrative**: generates an audit-grade narrative using a multi-LLM pipeline: **OpenAI draft → Claude review → Gemini gate**.

## Repository layout

- `nucleo-ledger/` — Ledger service (cases, calculations, audit pack)
- `nucleo-narrative/` — Narrative service (multi-LLM pipeline)
- `db/` — Postgres schema + migrations
- `infra/` — Docker / deployment config
- `orchestration-n8n/` — n8n workflows + notes (planned/optional)
- `docs/` — PRD, prompts, runbooks, audit approach

## Services

### nucleo-ledger (port 8000)

What it does:
- **Audit pack / report-package** generation for a case
- **Calculations** (e.g., scopes, totals, intensity)
- **Conflict gating** and **resolution log** (who picked what value and why)
- **Factor set** references (currently placeholder; planned: DEFRA)

Key endpoints:
- `GET /api/health`
- `GET /api/cases/{case_id}/report-package`

### nucleo-narrative (port 8001)

What it does:
- Pulls the **report-package** from `nucleo-ledger`
- Generates:
  1) **OpenAI** drafts the narrative
  2) **Claude** reviews and improves writing/clarity without changing facts
  3) **Gemini** acts as a final gate (approve / flag issues)
- Returns `final_narrative_md` when approved; otherwise sets `human_review_required`

Key endpoints:
- `GET /api/health`
- `POST /api/cases/{case_id}/narrative/pipeline`

## Ports

- `nucleo-ledger`: `http://127.0.0.1:8000`
- `nucleo-narrative`: `http://127.0.0.1:8001`

## Environment variables

Each service has its own `.env` (not committed). Copy from `.env.example`.

### nucleo-ledger (.env)

Required (typical):
- `DATABASE_URL` (Postgres connection string)

### nucleo-narrative (.env)

Required:
- `NUCLEO_LEDGER_URL` (e.g., `http://127.0.0.1:8000`)
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

Optional:
- `OPENAI_MODEL` (defaults in code)
- `ANTHROPIC_MODEL` (defaults in code)
- `GEMINI_MODEL` (defaults in code)

## Local run (venv)

> Run each service in its own terminal.

### 1) nucleo-ledger

```bash
cd nucleo-ledger
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Health check:

```bash
curl -s http://127.0.0.1:8000/api/health
```

### 2) nucleo-narrative

```bash
cd nucleo-narrative
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

Health check:

```bash
curl -s http://127.0.0.1:8001/api/health
```

## Run the narrative pipeline

Replace `{case_id}` with a real case UUID:

```bash
curl -s -X POST http://127.0.0.1:8001/api/cases/{case_id}/narrative/pipeline | python -m json.tool
```

## Next milestones

Planned build sequence:
1. Stabilise (README + golden fixture)
2. Convert narrative to **structured JSON-first output**
3. Replace emission factors with **DEFRA**
4. Add **Slack hook** for `human_review_required`
5. Add **auto-redraft loop** (bounded + safe)
6. Add **n8n orchestration**
7. Output polish: **Markdown + DOCX** (Claude for DOCX)