# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

### Setup
```bash
python3 -m venv .venv && source .venv/bin/activate
./scripts/install_all.sh          # installs all packages into the root .venv
```

### Running tests
Tests must be run from the **repo root** so that `pytest.ini` resolves `pythonpath` correctly (`.`, `nucleo-ledger`, `api`). Running from inside a service subdirectory breaks imports.

```bash
pytest                                      # all tests
pytest nucleo-ledger/tests                  # ledger only
pytest api/tests                            # consolidated api tests
pytest -k "test_auth"                       # filter by name
pytest nucleo-ledger/tests/test_auth_jwt.py # single file
```

If running outside the root venv, prefix with:
```bash
PYTHONPATH=.:nucleo-ledger:api python -m pytest ...
```

### Running the service locally
```bash
# Single consolidated api service → http://127.0.0.1:8000
# Run from the repo root OR from inside api/ — both work.
uvicorn main:app --reload --app-dir api
```

### Docker (full stack)
```bash
cp .env.example .env
docker compose up --build
```

### End-to-end smoke test
```bash
./scripts/demo_cbam_e2e.sh          # API_URL / EORI / INVOICE / YEAR / QUARTER
```

---

## Architecture

Single FastAPI service (`api/`) that consolidates the former ledger and narrative microservices into one process. All protected routes require a Bearer JWT.

```
api/  (port 8000)
  └─ Supabase (PostgreSQL + RLS)
  └─ Supabase Storage (evidence documents)
  └─ Single Claude call (narrative pipeline)
```

### api/ — consolidated service

`api/main.py` mounts all routers. It imports ledger routers from `nucleo-ledger/ledger_app/` — both packages run in-process with no inter-service HTTP. `nucleo-narrative` has been dissolved; its live code lives in `api/app/`.

Key layers:
- `api/app/api/` — consolidated API routers (narrative_pipeline, cbam_compliance, cpr, verification, registration, public_tools, supplier_outreach)
- `api/app/services/` — business logic: `narrative`, `compliance_pack`, `hmrc_return_builder`, `cpr_calculator`, `report_validator`, `cbam_free_allocation`, `cbam_uk_rates`, `eu_xml_builder`, `registration_manager`, `notifications`
- `ledger_app/api/` — 17 FastAPI routers (cases, documents, extract, calculate, bundle, resolve, report_package, cbam, auth, health, etc.)
- `ledger_app/services/` — business logic: `cbam_extractor`, `cbam_arbiter`, `cbam_repair`, `cbam_explain`, `snapshot_store`, `storage`, and the LlamaIndex orchestration layer
- `ledger_app/db/` — SQLAlchemy models and migrations
- `ledger_app/models/` — Pydantic schemas
- `ledger_app/testing.py` — shared `TestClient` factory used by conftest

Primary workflow: upload invoice → LlamaIndex routing → structured extraction → arbiter resolves conflicts → repair fills gaps → bundle into report package.

### Narrative pipeline — single Claude call
The narrative pipeline runs entirely in-process (no inter-service HTTP):

1. Fetch report package via direct function call to the ledger report builder
2. Single **Claude** call generates the full narrative (executive_summary, methodology, limitations, open_gaps)
3. `results{}` is **hard-overridden** with authoritative values from the report package — Claude cannot alter calculation outputs
4. Deterministic validator (replaces former Gemini QA gate) checks narrative integrity
5. Review flag persisted to ledger; Slack notification fired as BackgroundTask if `human_review_required`

Key file: `api/app/api/narrative_pipeline.py` — registers at the same paths as the old pipeline router so external callers see no change.

### shared_auth — JWT library (used by all code)
```
shared_auth/
  jwt.py           # create_access_token / decode_access_token (HS256, pure-Python fallback)
  models.py        # AuthContext(sub, tenant_id, scopes, jti, exp)
  dependencies.py  # get_auth_context (FastAPI dep), require_scopes factory
  testing.py       # make_test_token() — use this in all tests
  __init__.py      # public re-exports
```

`get_auth_context` is applied at the router level in `api/main.py`. Fine-grained scope checks (`require_scopes(["narrative:run"])`) are applied per-endpoint.

### Authentication flow
- All API routes (except `/health`, `/ready`, `/`) require `Authorization: Bearer <JWT>`
- Dev tokens: `POST /api/auth/token` — only available when `AUTH_DEV_TOKEN_ENDPOINT=true`
- Tests use `make_test_token()` from `shared_auth.testing` and the `make_auth_headers` fixture in each `conftest.py`

---

## Key environment variables

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL DSN; SQLite (`sqlite:///./cbam_test.db`) in tests |
| `SUPABASE_URL` | Supabase project URL (enables Supabase client + Storage) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `JWT_SECRET` | HS256 signing key; default `dev-jwt-secret-change-me` |
| `JWT_ISSUER` | default `scope3-agentic` |
| `JWT_AUDIENCE` | default `scope3-clients` |
| `JWT_EXPIRES_SECONDS` | default `3600` |
| `AUTH_DEV_TOKEN_ENDPOINT` | set `true` locally to enable `/api/auth/token` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude — required for narrative pipeline |
| `FIELD_ENCRYPTION_KEY` | AES field-level encryption key |
| `AUDIT_SIGNING_KEY` | HMAC key for signed audit log |
| `SLACK_WEBHOOK_URL` | Slack notifications (human review alerts) |

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
