"""
Router registration for the consolidated nucleo API.

Three groups are registered in order:

  1. core      — health, deep-health (no auth)
  2. ledger    — 17 ledger_app routers (all require auth except /health)
  3. platform  — consolidated app routers: narrative, compliance, CPR, etc.

Keeping all include_router() calls here (rather than scattered in main.py) means
main.py stays readable and adding/removing a router is a one-line change in the
right group, not a hunt through a 276-line file.
"""
from __future__ import annotations

from fastapi import Depends, FastAPI

from shared_auth import get_auth_context


def register_all(app: FastAPI) -> None:
    _register_core(app)
    _register_ledger(app)
    _register_platform(app)


# ── 1. Core (no auth) ─────────────────────────────────────────────────────────

def _register_core(app: FastAPI) -> None:
    from app.core.health import router as deep_health_router
    from ledger_app.api.health import router as health_router

    app.include_router(deep_health_router)
    app.include_router(health_router, prefix="/api")
    app.include_router(health_router)          # root /health + /ready (no prefix)


# ── 2. Ledger routers (17) ────────────────────────────────────────────────────

def _register_ledger(app: FastAPI) -> None:
    from ledger_app.api.audit import router as audit_router
    from ledger_app.api.auth import protected_router as auth_protected_router
    from ledger_app.api.auth import router as auth_router
    from ledger_app.api.bundle import router as bundle_router
    from ledger_app.api.calculate import router as calculate_router
    from ledger_app.api.cases import router as cases_router
    from ledger_app.api.cbam_extraction import router as cbam_extraction_router
    from ledger_app.api.cbam import router as cbam_router
    from ledger_app.api.db_check import router as db_check_router
    from ledger_app.api.extract import router as extract_router
    from ledger_app.api.gaps import router as gaps_router
    from ledger_app.api.report_package import router as report_package_router
    from ledger_app.api.resolve import router as resolve_router
    from ledger_app.api.review import router as review_router
    from ledger_app.api.storage_check import router as storage_check_router

    _auth = [Depends(get_auth_context)]

    # Auth endpoints — public token issuance + protected scope-check
    app.include_router(auth_router, prefix="/api")
    app.include_router(auth_protected_router, prefix="/api", dependencies=_auth)

    # Infrastructure checks
    app.include_router(db_check_router, prefix="/api", dependencies=_auth)
    app.include_router(storage_check_router, prefix="/api", dependencies=_auth)

    # Case lifecycle
    app.include_router(cases_router, prefix="/api", dependencies=_auth)
    app.include_router(cbam_extraction_router, prefix="/api", dependencies=_auth)
    app.include_router(extract_router, prefix="/api", dependencies=_auth)
    app.include_router(calculate_router, prefix="/api", dependencies=_auth)
    app.include_router(bundle_router, prefix="/api", dependencies=_auth)
    app.include_router(gaps_router, prefix="/api", dependencies=_auth)
    app.include_router(resolve_router, prefix="/api", dependencies=_auth)
    app.include_router(report_package_router, prefix="/api", dependencies=_auth)

    # CBAM-specific ledger endpoints
    app.include_router(cbam_router, prefix="/api", dependencies=_auth)

    # Audit + review
    app.include_router(audit_router, prefix="/api", dependencies=_auth)
    app.include_router(review_router, prefix="/api", dependencies=_auth)


# ── 3. Platform routers (consolidated app/) ───────────────────────────────────

def _register_platform(app: FastAPI) -> None:
    from app.api.cbam_compliance import router as cbam_compliance_router
    from app.api.cpr import router as cpr_router
    from app.api.narrative_pipeline import router as narrative_pipeline_router
    from app.api.public_tools import router as public_tools_router
    from app.api.registration import router as registration_router
    from app.api.supplier_outreach import router as supplier_outreach_router
    from app.api.supplier_token import (
        protected_router as supplier_token_protected_router,
        public_router as supplier_token_public_router,
    )
    from app.api.verification import router as verification_router

    _auth = [Depends(get_auth_context)]

    # Public — no auth
    app.include_router(public_tools_router, prefix="/api")
    app.include_router(supplier_token_public_router, prefix="/api")

    # Auth-gated platform endpoints
    app.include_router(cpr_router, prefix="/api", dependencies=_auth)
    app.include_router(registration_router, prefix="/api", dependencies=_auth)
    app.include_router(supplier_outreach_router,        prefix="/api", dependencies=_auth)
    app.include_router(supplier_token_protected_router, prefix="/api", dependencies=_auth)
    app.include_router(verification_router, prefix="/api", dependencies=_auth)
    app.include_router(cbam_compliance_router, prefix="/api", dependencies=_auth)
    app.include_router(narrative_pipeline_router, prefix="/api", dependencies=_auth)
