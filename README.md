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

Use the root `.env` for local + docker-compose:

```bash
cp .env.example .env
```

### nucleo-ledger (.env)

Required (typical):
- `DATABASE_URL` (Postgres connection string)

### nucleo-narrative (.env)

Required:
- `LEDGER_URL` or `LEDGER_BASE_URL` (e.g., `http://127.0.0.1:8000`)

Optional:
- `OPENAI_API_KEY` (needed only for OpenAI draft stage)
- `ANTHROPIC_API_KEY` (Claude review is skipped if missing)
- `GEMINI_API_KEY` (Gemini gate is skipped if missing)
- `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL` (defaults in code)

## Local run (venv)

> Run each service in its own terminal.

### Root `.venv` setup (recommended)

1. Create virtual environment at repo root:

```bash
python3 -m venv .venv
```

2. Install dependencies for both services:

```bash
./scripts/install_all.sh
```

3. Start `nucleo-ledger` on port `8000`:

```bash
source .venv/bin/activate
cd nucleo-ledger
python -m uvicorn ledger_app.main:app --host 127.0.0.1 --port 8000 --reload
```

4. Start `nucleo-narrative` on port `8001` (new terminal):

```bash
source .venv/bin/activate
cd nucleo-narrative
python -m uvicorn narrative_app.main:app --host 127.0.0.1 --port 8001 --reload
```

### 1) nucleo-ledger

```bash
cd nucleo-ledger
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn ledger_app.main:app --host 127.0.0.1 --port 8000 --reload
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
python -m uvicorn narrative_app.main:app --host 127.0.0.1 --port 8001 --reload
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

## Docker Compose

Run both APIs plus Postgres from the repo root:

```bash
cp .env.example .env
docker compose up --build
```

Services exposed:
- `nucleo-ledger`: `http://127.0.0.1:8000`
- `nucleo-narrative`: `http://127.0.0.1:8001`

Health checks:
- Ledger readiness: `http://127.0.0.1:8000/ready`
- Narrative health: `http://127.0.0.1:8001/health`

Notes:
- `docker-compose.yml` uses `.env` for configuration.
- Narrative waits on Ledger health before startup and also uses retry/backoff in its ledger HTTP client for transient startup/network issues.

## Next milestones

Planned build sequence:
1. Stabilise (README + golden fixture)
2. Convert narrative to **structured JSON-first output**
3. Replace emission factors with **DEFRA**
4. Add **Slack hook** for `human_review_required`
5. Add **auto-redraft loop** (bounded + safe)
6. Add **n8n orchestration**
7. Output polish: **Markdown + DOCX** (Claude for DOCX)
