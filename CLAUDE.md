# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@CBAM-reg.md

@.claude/nucleos-skills/ceo.md
@.claude/nucleos-skills/brand.md
@.claude/nucleos-skills/design.md
@.claude/nucleos-skills/marketing.md
@.claude/nucleos-skills/operations.md
@.claude/nucleos-skills/product.md
@.claude/nucleos-skills/project.md
@.claude/nucleos-skills/sales.md
@.claude/nucleos-skills/skills.md
@.claude/nucleos-skills/software.md
@.claude/nucleos-skills/test.md

---

## Arbor integration — non-negotiable rules

Nucleos is being brought into Arbor as one product: one login, one database of record, one UI, one domain, one bill. Not one codebase — Arbor stays TypeScript, Nucleos stays Python, two repos, two deployments. Arbor owns the browser, auth, documents, document→text extraction, provenance and the audit chain. Nucleos owns text→CBAM structure, emissions method selection, CPR, free allocation, and the report builders. The boundary carries text and metadata in, structured fields out.

These seven rules govern every change made here. They are not preferences.

1. **Do not port CBAM domain logic to TypeScript.** The regex extractor, arbiter, repair layer, emissions selector, CPR calculator, free allocation, and report builders stay Python. These encode accumulated domain knowledge a rebuild loses silently.
2. **Do not rewrite Arbor in Python.**
3. **Nucleos never writes to Arbor's database.** Results return over the boundary; Arbor writes them.
4. **Nucleos keeps a database, but loses ownership of anything Arbor also models** — documents and blobs, extracted field records, provenance tiers, the audit chain. It retains CBAM cases, goods lines, emissions selections, and processing snapshots, because those are domain state Arbor has no model for. If you find Nucleos writing to a concept Arbor also models, surface it and stop.
5. **Do not change calculation logic during integration.** Interface changes only; behavioural changes get flagged, not implemented. The default-value mark-up schedule (fix F6) is the single sanctioned exception and is explicitly versioned.
6. **Extraction produces drafts. Only a human action in Arbor's Review screen sets a provenance tier.**
7. **Arbor has been forked for a separate product.** Keep diffs surgical. Every broad refactor of shared Arbor code widens that divergence.

**Two orthogonal axes, never conflated.** Arbor's `provenanceTier` (`VERIFIED | DECLARED | ESTIMATED`) says how much to trust a record's origin. Nucleos's `emissionsMethod` (`ACTUAL | ESTIMATED | DEFAULT`) says which emissions value entered the calculation. Never use the word "tier" for the Nucleos axis, in code, schema, or UI copy. Both travel on every goods line; neither derives from the other.

**Working practice.** Announce the repo before editing. Work on a branch; never commit to main. Run the golden set after every phase and report the result before continuing. Stop at phase boundaries and wait. If anything in the integration plan conflicts with what you find in the code, raise it rather than resolving it.

**The golden set** (`golden/`, run with `pytest api/tests/golden`) freezes what the CBAM engine computes. It must pass unchanged after every phase. When it fails, assume the change is wrong before assuming the golden file is. Regenerating is deliberate and reviewed — `GOLDEN_UPDATE=1` — never a way to clear a red suite. See `golden/README.md`.

---

## Code quality — required at all times

These are not preferences. Apply them to every file touched, without being asked.

- **No placeholder stubs.** Never leave a file with `return null` and a "rebuild with design system" comment. Either implement it or delete it.
- **No manifesto comments.** Do not write block comments that describe design philosophy, list constraints, or explain what the product does. That belongs in documentation, not in code.
- **No decorative dividers.** `// ── Section name ──────────` lines that carry no information must not be written. A blank line is sufficient separation.
- **No stale comments.** If a comment describes something that no longer exists or was changed, remove it. Stale comments are worse than no comments.
- **No TODO comments in committed code.** A TODO is an unfinished implementation. Finish it or track it externally — do not commit it.
- **Comments explain why, never what.** The code already says what it does. A comment is only justified when the reason would surprise a reader: a regulatory constraint, a non-obvious invariant, a workaround for a specific bug.
- **One source of truth.** If the same constraint is stated in two places (e.g. globals.css and design-system.ts), one is wrong. Consolidate.
- **Dead code is deleted.** Unused imports, unused functions, unused files — remove them. Do not comment them out.

---

## Commands

### Setup
```bash
python3 -m venv .venv && source .venv/bin/activate
./scripts/install_all.sh          # installs all packages into the root .venv
```

### Running tests
Tests must be run from the **repo root** so that `pytest.ini` resolves `pythonpath` correctly (`.`, `api`). Running from inside a service subdirectory breaks imports.

```bash
pytest                                          # all tests
pytest api/tests/ledger/                        # ledger only
pytest api/tests/                               # all api tests
pytest -k "test_auth"                           # filter by name
pytest api/tests/ledger/test_auth_jwt.py        # single file
```

If running outside the root venv, prefix with:
```bash
PYTHONPATH=.:api python -m pytest ...
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

`api/main.py` mounts all routers. All application code lives under `api/` — no separate editable installs or sibling packages.

Key layers:
- `api/app/api/` — consolidated API routers (narrative_pipeline, cbam_compliance, cpr, verification, registration, public_tools, supplier_outreach)
- `api/app/services/` — business logic: `narrative`, `compliance_pack`, `hmrc_return_builder`, `cpr_calculator`, `report_validator`, `cbam_free_allocation`, `cbam_uk_rates`, `eu_xml_builder`, `registration_manager`, `notifications`
- `api/ledger_app/api/` — 17 FastAPI routers (cases, documents, extract, calculate, bundle, resolve, report_package, cbam, auth, health, etc.)
- `api/ledger_app/services/` — business logic: `cbam_extractor`, `cbam_arbiter`, `cbam_repair`, `cbam_explain`, `snapshot_store`, `storage`, and the text-chunking orchestration layer
- `api/ledger_app/db/` — SQLAlchemy models and migrations
- `api/ledger_app/models/` — Pydantic schemas
- `api/ledger_app/testing.py` — shared `TestClient` factory used by conftest
- `api/shared_auth/` — HS256 JWT library (create/decode tokens, FastAPI deps, scope enforcement)

Primary workflow: upload invoice → text extraction and chunking → structured extraction → arbiter resolves conflicts → repair fills gaps → bundle into report package.

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
api/shared_auth/
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
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (`sb_secret_...`) — full access, bypasses RLS |
| `SUPABASE_ANON_KEY` | Supabase publishable key (`sb_publishable_...`) — RLS enforced |

Supabase key notes: legacy `anon`/`service_role` JWT keys are deprecated end of 2026 — use the `sb_publishable_...`/`sb_secret_...` formats. New-format keys must be sent in the `apikey` header only; passing one as `Authorization: Bearer` makes the gateway parse it as a JWT and reject it (supabase-js ≥2.x and supabase-py ≥2.30 handle this correctly). The bare `/rest/v1/` root (OpenAPI schema) always requires a secret key — test against a table path, not the root.
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
- `api/test_docs/sample_invoice.pdf` — sample invoice for extraction tests

The `storage/` directory is runtime object storage and is gitignored.
