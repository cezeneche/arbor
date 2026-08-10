# Nucleos — CBAM Compliance Platform

A CBAM (Carbon Border Adjustment Mechanism) compliance platform for UK and EU carbon border tax returns. Processes supplier documents into legally defensible audit-ready outputs.

## Repository layout

```
api/                  — consolidated FastAPI service (port 8000)
  app/api/            — narrative pipeline, CPR, registration, verification, compliance routers
  app/services/       — narrative, compliance pack, HMRC return builder, CPR, report validator
nucleo-ledger/        — ledger package (imported in-process by api/)
  ledger_app/api/     — 17 FastAPI routers: cases, documents, extract, calculate, bundle, etc.
  ledger_app/services/— CBAM extractor, arbiter, repair, snapshot store, emission factors
  ledger_app/db/      — SQLAlchemy models and migrations
shared_auth/          — HS256 JWT library used across all code
scripts/              — e2e demo scripts
fixtures/             — golden test data (ledger + narrative)
```

## Architecture

Single FastAPI process — no microservices, no inter-service HTTP.

```
api/ (port 8000)
  └─ Supabase (PostgreSQL + RLS)
  └─ Supabase Storage (evidence documents)
  └─ Single Claude call (narrative pipeline)
```

Primary workflow: Arbor extracts document text → POST /api/internal/cbam/extract → structured extraction → arbiter resolves conflicts → repair fills gaps → bundle into report package → Claude generates narrative → deterministic validator → compliance pack.

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
./scripts/install_all.sh
```

## Running locally

```bash
source .venv/bin/activate
uvicorn main:app --reload --app-dir api
```

Service available at `http://127.0.0.1:8000`. Swagger UI at `http://127.0.0.1:8000/docs`.

## Running tests

Run from the **repo root** (pytest.ini sets pythonpath):

```bash
pytest                              # all tests (895+)
pytest nucleo-ledger/tests          # ledger tests only
pytest api/tests                    # api/narrative tests only
pytest -k "test_auth"               # filter by name
```

## Docker (full stack)

```bash
cp .env.example .env
docker compose up --build
```

## Key environment variables

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL DSN; `sqlite:///./cbam_test.db` in tests |
| `SUPABASE_URL` | Supabase project URL (enables client + Storage) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `JWT_SECRET` | HS256 signing key; default `dev-jwt-secret-change-me` |
| `JWT_ISSUER` | default `scope3-agentic` |
| `JWT_AUDIENCE` | default `scope3-clients` |
| `JWT_EXPIRES_SECONDS` | default `3600` |
| `AUTH_DEV_TOKEN_ENDPOINT` | `true` to enable `POST /api/auth/token` locally |
| `ANTHROPIC_API_KEY` | Required for narrative pipeline |
| `ANTHROPIC_MODEL` | Claude model ID (defaults to latest Sonnet) |
| `FIELD_ENCRYPTION_KEY` | AES field-level encryption key |
| `AUDIT_SIGNING_KEY` | HMAC key for signed audit log |
| `SLACK_WEBHOOK_URL` | Slack alerts for human review required |

## Auth

- `GET /health`, `GET /ready`, `GET /` — public
- All `/api/*` routes require `Authorization: Bearer <JWT>`
- Dev token (local only): `POST /api/auth/token` when `AUTH_DEV_TOKEN_ENDPOINT=true`

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"sub":"dev-user","tenant_id":"dev-tenant","scopes":["cbam:write","narrative:run"]}' \
  | python -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
```

## End-to-end smoke test

```bash
./scripts/demo_cbam_e2e.sh
```

Or the live demo (requires real Supabase + Anthropic keys):

```bash
RECIPIENT_EMAIL=your@email.com python scripts/demo_live.py
```
