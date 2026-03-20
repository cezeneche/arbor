"""
Shared fixtures for the E2E integration test suite.

All three tests run against a real PostgreSQL / Supabase database.
Set TEST_DATABASE_URL=postgresql+psycopg2://... to enable them.

External APIs mocked:
  - Slack webhook  (SLACK_INTERNAL_WEBHOOK_URL) — respx
  - Resend email   (https://api.resend.com/emails) — respx
  - Claude API     (app.services.narrative._call_claude) — monkeypatch

No mocks for database or Supabase Storage.
"""
from __future__ import annotations

import json
import os
import sys
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import pytest

# ── Path setup ────────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parent.parent
for _pkg in ["api", "nucleo-ledger", "nucleo-narrative", "."]:
    _p = str(_REPO_ROOT / _pkg)
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ── Env vars (set BEFORE any app import) ─────────────────────────────────────
_TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "")
os.environ.setdefault(
    "DATABASE_URL",
    _TEST_DB_URL if _TEST_DB_URL else "sqlite:///./e2e_test.db",
)
os.environ.setdefault("JWT_SECRET",           "e2e-test-jwt-secret-32b-not-for-production!")
os.environ.setdefault("AUDIT_SIGNING_KEY",    "e2e-test-audit-signing-key-distinct-from-jwt!")
os.environ.setdefault("FIELD_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
os.environ.setdefault("JWT_ISSUER",           "scope3-agentic")
os.environ.setdefault("JWT_AUDIENCE",         "scope3-clients")
os.environ.setdefault("JWT_EXPIRES_SECONDS",  "3600")
os.environ.setdefault("AUTH_DEV_TOKEN_ENDPOINT", "true")
os.environ.setdefault("CBAM_REGISTRATION_SCHEDULER", "false")
os.environ.setdefault("ANTHROPIC_API_KEY",    "")          # never call real Claude in E2E
os.environ.setdefault("SUPABASE_URL",         _TEST_DB_URL and os.environ.get("SUPABASE_URL", "") or "")
# Slack and Resend are set to predictable test URLs so respx can intercept them
os.environ.setdefault(
    "SLACK_INTERNAL_WEBHOOK_URL",
    "https://hooks.slack.com/test-e2e/T000/B000/XXXX",
)
os.environ.setdefault("RESEND_API_KEY",    "re_test_e2e_key_placeholder")
os.environ.setdefault("RESEND_FROM_EMAIL", "test@nucleos.io")
os.environ.setdefault("SUPPORT_EMAIL",     "support@nucleos.io")
os.environ.setdefault("BASE_URL",          "https://app.nucleos.io")

# ── Skip marker ───────────────────────────────────────────────────────────────
_DB_URL = os.environ.get("DATABASE_URL", "")
_HAS_POSTGRES = _DB_URL.startswith("postgresql") or _DB_URL.startswith("postgres")

requires_supabase = pytest.mark.skipif(
    not _HAS_POSTGRES,
    reason=(
        "E2E tests require a real PostgreSQL/Supabase database. "
        "Set TEST_DATABASE_URL=postgresql+psycopg2://... to enable."
    ),
)

# ── Fixtures directory ────────────────────────────────────────────────────────
FIXTURE_DIR = Path(__file__).parent / "fixtures"


# ── App + client fixtures ─────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def app():
    """Import and return the consolidated FastAPI application."""
    from main import app as _app
    return _app


@pytest.fixture()
def tenant_id() -> str:
    """Unique tenant UUID per test — ensures RLS isolation."""
    return f"e2e-{uuid4().hex[:16]}"


@pytest.fixture()
def make_headers(tenant_id: str):
    """Factory: return auth headers for arbitrary scope combinations."""
    from shared_auth.testing import make_test_token

    def _make(scopes: list[str] | None = None) -> dict[str, str]:
        token = make_test_token(
            sub="e2e-test-user",
            tenant_id=tenant_id,
            scopes=scopes or [
                "cbam:read", "cbam:write",
                "narrative:run", "review:write",
            ],
        )
        return {"Authorization": f"Bearer {token}"}

    return _make


@pytest.fixture()
def client(app, make_headers):
    """TestClient with full-scope auth headers attached."""
    from starlette.testclient import TestClient
    return TestClient(app, headers=make_headers())


# ── Claude mock ───────────────────────────────────────────────────────────────

@pytest.fixture()
def mock_claude(monkeypatch):
    """Patch _call_claude so tests never call the real Anthropic API.

    Returns the fixture narrative dict; tests can override individual keys
    via the returned dict reference before calling the pipeline.
    """
    narrative = json.loads((FIXTURE_DIR / "narrative_response.json").read_text())

    import app.services.narrative as _narrative_mod
    monkeypatch.setattr(_narrative_mod, "_call_claude", lambda packet: dict(narrative))
    return narrative


# ── External API mocks ────────────────────────────────────────────────────────

@pytest.fixture()
def slack_mock():
    """respx mock for the Slack incoming webhook.

    Captures the full request body so tests can assert on payload fields.
    """
    import respx
    from httpx import Response as R

    slack_url = os.environ["SLACK_INTERNAL_WEBHOOK_URL"]
    with respx.mock(assert_all_called=False) as mock:
        mock.post(slack_url).mock(return_value=R(200, text="ok"))
        yield mock


@pytest.fixture()
def resend_mock():
    """respx mock for the Resend transactional email API.

    Returns {"id": "test-email-id-e2e"} so callers that parse the response
    do not crash.
    """
    import respx
    from httpx import Response as R

    with respx.mock(assert_all_called=False) as mock:
        mock.post("https://api.resend.com/emails").mock(
            return_value=R(200, json={"id": "test-email-id-e2e"})
        )
        yield mock


# ── Synthetic PDF factory ─────────────────────────────────────────────────────

def build_invoice_pdf(fields: dict[str, str]) -> bytes:
    """Generate a minimal synthetic invoice PDF using reportlab.

    The text is formatted to be parseable by the platform's regex extractor:
    key-value pairs on separate lines, units spelled out.
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    y = height - 50

    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, y, "COMMERCIAL INVOICE")
    y -= 30

    c.setFont("Helvetica", 11)
    for key, value in fields.items():
        c.drawString(50, y, f"{key}: {value}")
        y -= 18
        if y < 100:
            c.showPage()
            y = height - 50
            c.setFont("Helvetica", 11)

    c.save()
    buf.seek(0)
    return buf.read()


@pytest.fixture()
def steel_invoice_pdf() -> bytes:
    """Synthetic steel invoice — Test 1."""
    return build_invoice_pdf({
        "Invoice Number":         "INV-2027-001",
        "Import Date":            "2027-03-15",
        "Origin Country":         "DE",
        "CN Code":                "72082700",
        "CN Description":         "Flat-rolled products iron or non-alloy steel width 600mm",
        "Net Mass":               "500000 kg",
        "Direct Embedded Emissions": "850000 kgCO2e",
        "Production Route":       "EAF",
        "Supplier":               "Thyssenkrupp Steel Europe Duisburg Germany",
        "Importer EORI":          "GB123456789000",
    })


@pytest.fixture()
def cement_invoice_pdf() -> bytes:
    """Synthetic cement invoice — Test 2 (no emissions data)."""
    return build_invoice_pdf({
        "Invoice Number":  "INV-CEMENT-2027-042",
        "Import Date":     "2027-06-20",
        "Origin Country":  "TR",
        "CN Code":         "25232900",
        "CN Description":  "Portland cement",
        "Net Mass":        "10000 kg",
        "Supplier":        "Cimentas Turkey",
        "Importer EORI":   "GB987654321000",
    })


@pytest.fixture()
def aluminium_invoice_pdf() -> bytes:
    """Synthetic aluminium invoice with CPR note — Test 3."""
    return build_invoice_pdf({
        "Invoice Number":         "INV-AL-2027-007",
        "Import Date":            "2027-09-10",
        "Origin Country":         "NO",
        "CN Code":                "76011000",
        "CN Description":         "Aluminium not alloyed unwrought",
        "Net Mass":               "200000 kg",
        "Direct Embedded Emissions":   "360000 kgCO2e",
        "Indirect Embedded Emissions": "520000 kgCO2e",
        "Production Route":       "primary_electrolysis",
        "Carbon Price Note":      "Norwegian CO2 tax NOK 1155 per tonne CO2",
        "Importer EORI":          "GB555444333000",
    })


# ── CBAM rate seeding ─────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def seed_cbam_rates(app):
    """Insert test CBAM UK rates into the database (idempotent).

    Rates are test-only values per the spec:
      iron_steel  2027-Q1  GBP 52.40
      cement      2027-Q2  GBP 51.80
      aluminium   2027-Q3  GBP 53.10

    Uses ON CONFLICT DO NOTHING so repeated test runs are safe.
    """
    if not _HAS_POSTGRES:
        yield
        return

    from ledger_app.api.cbam._shared import engine
    from sqlalchemy import text

    rates = [
        ("iron_steel",  2027, 1, "52.40"),
        ("cement",      2027, 2, "51.80"),
        ("aluminium",   2027, 3, "53.10"),
    ]
    with engine.begin() as conn:
        try:
            for sector, year, quarter, rate in rates:
                conn.execute(
                    text(
                        """
                        INSERT INTO cbam.cbam_uk_rates
                            (sector, reporting_year, reporting_quarter, rate_gbp_per_tco2e, source)
                        VALUES (:sector, :year, :quarter, :rate, 'e2e_test_seed')
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {
                        "sector": sector,
                        "year": year,
                        "quarter": quarter,
                        "rate": rate,
                    },
                )
        except Exception:
            pass  # table may not exist; tests will use in-memory rate fallback
    yield


# ── Cleanup helper ────────────────────────────────────────────────────────────

@pytest.fixture()
def cleanup_cbam_cases():
    """Collect CBAM case IDs created during a test and delete them after.

    Usage:
        def test_something(cleanup_cbam_cases):
            case_id = ...
            cleanup_cbam_cases.append(case_id)
    """
    created: list[str] = []
    yield created

    if not _HAS_POSTGRES or not created:
        return

    from ledger_app.api.cbam._shared import engine
    from sqlalchemy import text

    with engine.begin() as conn:
        for case_id in created:
            try:
                # CASCADE removes shipments, goods lines, emissions, CPR claims, snapshots
                conn.execute(
                    text("DELETE FROM cbam.cbam_cases WHERE id = :id"),
                    {"id": case_id},
                )
            except Exception:
                pass
