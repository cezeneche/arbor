"""
Conftest for the consolidated api/ integration test suite.

Adds the api/ directory to sys.path so that ``from main import app`` and
``from app.services...`` resolve correctly regardless of how pytest is invoked.

Run from the repo root:
    pytest api/tests/ -v
    # or with a PostgreSQL test database:
    TEST_DATABASE_URL="postgresql+psycopg2://..." pytest api/tests/ -v
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Ensure api/ (this file's parent's parent) is on sys.path so that
# ``from main import app`` and ``from app.services...`` resolve.
_API_DIR = str(Path(__file__).parent.parent)
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

# ── Test environment defaults (before any app import) ──────────────────────────
# Pre-claim TEST_DATABASE_URL so that load_dotenv() (called at module level in
# ledger_app/core/config.py) cannot overwrite it with the repo's .env value and
# cause test_full_pipeline.py to evaluate _HAS_POSTGRES=True when no real
# Postgres was explicitly provided by the caller.
os.environ.setdefault("TEST_DATABASE_URL", "")
os.environ.setdefault(
    "DATABASE_URL",
    os.environ.get("TEST_DATABASE_URL") or "sqlite:///./test_full_pipeline.db",
)
os.environ.setdefault("JWT_SECRET",            "test-jwt-secret-for-testing-only-32b")
os.environ.setdefault("AUDIT_SIGNING_KEY",     "test-audit-signing-key-distinct-from-jwt!")
os.environ.setdefault("FIELD_ENCRYPTION_KEY",  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
os.environ.setdefault("JWT_ISSUER",            "scope3-agentic")
os.environ.setdefault("JWT_AUDIENCE",          "scope3-clients")
os.environ.setdefault("JWT_EXPIRES_SECONDS",   "3600")
os.environ.setdefault("AUTH_DEV_TOKEN_ENDPOINT", "true")
os.environ.setdefault("CBAM_REGISTRATION_SCHEDULER", "false")   # no APScheduler in tests
