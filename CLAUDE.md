# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

### Setup
```bash
python3 -m venv .venv && source .venv/bin/activate
./scripts/install_all.sh          # installs both services into the root .venv
```

### Running tests
Tests must be run from the **repo root** so that `pytest.ini` resolves `pythonpath` correctly (`.`, `nucleo-ledger`, `nucleo-narrative`). Running from inside a service subdirectory breaks imports.

```bash
pytest                                      # all tests
pytest nucleo-ledger/tests                  # ledger only
pytest nucleo-narrative/tests               # narrative only
pytest -k "test_auth"                       # filter by name
pytest nucleo-ledger/tests/test_auth_jwt.py # single file
```

If running outside the root venv, prefix with:
```bash
PYTHONPATH=.:nucleo-ledger:nucleo-narrative python -m pytest ...
```

### Running services locally
```bash
# nucleo-ledger  → http://127.0.0.1:8000
cd nucleo-ledger && ./run.sh        # RELOAD=0 ./run.sh to disable hot-reload

# nucleo-narrative → http://127.0.0.1:8001
cd nucleo-narrative && ./run.sh
```

### Docker (full stack)
```bash
cp .env.example .env
docker compose up --build
```

### End-to-end smoke test
```bash
./scripts/demo_cbam_e2e.sh          # LEDGER_URL / NARRATIVE_URL / EORI / INVOICE / YEAR / QUARTER
```

---

## Architecture

Two FastAPI microservices communicate over HTTP. All protected routes require a Bearer JWT.

```
nucleo-ledger  (port 8000)   ←─── nucleo-narrative (port 8001)
  └─ PostgreSQL                      └─ calls /api/cases/{id}/report-package
  └─ S3/MinIO (evidence)             └─ LLM pipeline (OpenAI → Claude → Gemini)
```

### nucleo-ledger — deterministic carbon ledger
Handles CBAM document ingestion, carbon calculations, conflict arbitration, and audit evidence.

Key layers:
- `ledger_app/api/` — 17 FastAPI routers (cases, documents, extract, calculate, bundle, resolve, report_package, cbam, auth, health, etc.)
- `ledger_app/services/` — business logic: `cbam_extractor`, `cbam_arbiter`, `cbam_repair`, `cbam_explain`, `snapshot_store`, `storage`, and the LlamaIndex orchestration layer
- `ledger_app/db/` — SQLAlchemy models and migrations
- `ledger_app/models/` — Pydantic schemas
- `ledger_app/testing.py` — shared `TestClient` factory used by conftest

Primary workflow: upload invoice → LlamaIndex routing → structured extraction → arbiter resolves conflicts → repair fills gaps → bundle into report package.

### nucleo-narrative — multi-LLM narrative pipeline
Fetches the structured report package from nucleo-ledger, then runs it through a three-stage LLM pipeline:

1. **OpenAI** — drafts initial narrative (`OPENAI_API_KEY`)
2. **Claude** — reviews and improves without changing facts (`ANTHROPIC_API_KEY`)
3. **Gemini** — gates approval or flags for human review (`GEMINI_API_KEY`)

Any stage is skipped gracefully if its API key is absent. Result is `final_narrative_md` or `human_review_required: true`.

Key file: `narrative_app/api/pipeline.py` — the route handler wires the three service calls together and enforces the `narrative:run` scope.

### shared_auth — JWT library (used by both services)
```
shared_auth/
  jwt.py           # create_access_token / decode_access_token (HS256, pure-Python fallback)
  models.py        # AuthContext(sub, tenant_id, scopes, jti, exp)
  dependencies.py  # get_auth_context (FastAPI dep), require_scopes factory
  testing.py       # make_test_token() — use this in all tests
  __init__.py      # public re-exports
```

`get_auth_context` is applied at the router level in each service's `main.py`. Fine-grained scope checks (`require_scopes(["narrative:run"])`) are applied per-endpoint.

### Authentication flow
- All API routes (except `/health`, `/ready`, `/`) require `Authorization: Bearer <JWT>`
- Dev tokens: `POST /auth/token` (or `/api/auth/token` on ledger) — only available when `AUTH_DEV_TOKEN_ENDPOINT=true`
- Tests use `make_test_token()` from `shared_auth.testing` and the `make_auth_headers` fixture in each `conftest.py`

---

## Key environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | ledger | PostgreSQL DSN; SQLite (`sqlite:///./cbam_test.db`) in tests |
| `LEDGER_URL` / `LEDGER_BASE_URL` | narrative | URL of the ledger service |
| `JWT_SECRET` | both | HS256 signing key; default `dev-jwt-secret-change-me` |
| `JWT_ISSUER` | both | default `scope3-agentic` |
| `JWT_AUDIENCE` | both | default `scope3-clients` |
| `JWT_EXPIRES_SECONDS` | both | default `3600` |
| `AUTH_DEV_TOKEN_ENDPOINT` | both | set `true` locally to enable `/auth/token` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | narrative | draft stage |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | narrative | review stage |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | narrative | gate stage |
| `S3_ENDPOINT_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | ledger | MinIO/S3 evidence storage |

Test conftest files set `DATABASE_URL`, `JWT_*`, and `AUTH_DEV_TOKEN_ENDPOINT` via `os.environ.setdefault`.

---

## Scopes
| Scope | Enforced on |
|---|---|
| `cbam:read` / `cbam:write` | Ledger CBAM routes (dev token default) |
| `narrative:run` | `POST /api/cases/{id}/narrative/pipeline` |
| `auth:test` | `GET /api/auth/scope-check` (test only) |

---

## Fixtures and golden data
- `fixtures/ledger/` — golden JSON report packages used in ledger tests
- `fixtures/ledger/snapshots/` — auditability snapshot fixtures
- `fixtures/narrative/` — golden narrative outputs
- `nucleo-ledger/test_docs/sample_invoice.pdf` — sample invoice for extraction tests

The `storage/` directory is runtime object storage and is gitignored.
