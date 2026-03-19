"""
núcleo API — consolidated FastAPI application.

Merges nucleo-ledger (17 routers, port 8000) and nucleo-narrative (LLM pipeline,
port 8001) into a single process on port 8000.

Key changes from the two-service architecture:
  - The narrative pipeline fetches report-package data via direct in-process
    function call (app.services.narrative.fetch_report_packet) instead of
    HTTP GET /api/cbam/cases/{id}/report-package.
  - Review flag/clear calls are direct function calls instead of HTTP POSTs.
  - LEDGER_URL / LEDGER_BASE_URL are no longer required.
  - All existing route paths are unchanged — external callers see no difference.

Startup sequence (lifespan):
  1. Supabase clients initialised (if SUPABASE_URL set)
  2. Annex VI emission factors seeded into DB (idempotent)
"""
import logging
import os
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError, ProgrammingError

from ledger_app.core.config import optional_startup_warnings, validate_startup_config
from shared_auth import get_auth_context

# ── Standard Python logging → stdout (readable in Supabase logs + any cloud) ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler()],
)
logging.root.setLevel(logging.INFO)

validate_startup_config()

_log = logging.getLogger("nucleos")


# ── Supabase client lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ────────────────────────────────────────────────────────────────
    if os.getenv("SUPABASE_URL"):
        try:
            from ledger_app.db.supabase_client import init_clients
            await init_clients()
            _log.info("Supabase clients initialised")
        except Exception as exc:
            _log.warning("Supabase client init failed (non-fatal): %s", exc)

    # Seed Annex VI emission factors (idempotent — skips if tables not ready yet)
    try:
        from ledger_app.api.cbam._shared import engine as _cbam_engine
        from ledger_app.services.cbam_factors_seeder import seed_emission_factors

        result = seed_emission_factors(_cbam_engine)
        if result.get("skipped"):
            _log.info("cbam_factors_seeder: tables not present yet — seed skipped")
        else:
            _log.info(
                "cbam_factors_seeder: annex_vi=%d electricity=%d version=%s",
                result["annex_vi_inserted"],
                result["electricity_inserted"],
                result.get("table_version", "?"),
            )
    except Exception as exc:
        _log.warning("cbam_factors_seeder: startup seed failed (non-fatal): %s", exc)

    yield

    # ── Shutdown ───────────────────────────────────────────────────────────────
    if os.getenv("SUPABASE_URL"):
        try:
            from ledger_app.db.supabase_client import close_clients
            await close_clients()
        except Exception:
            pass


app = FastAPI(title="núcleo API", version="0.1.0", lifespan=lifespan)

# ── OpenTelemetry distributed tracing (no-op when OTLP_ENDPOINT absent) ──────
from ledger_app.core.telemetry import setup_telemetry
setup_telemetry(app)

# ── HTTPS redirect (production) ───────────────────────────────────────────────
if os.getenv("FORCE_HTTPS", "").strip().lower() in ("1", "true", "yes"):
    from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
    app.add_middleware(HTTPSRedirectMiddleware)

# ── Tenant context middleware (sets app.current_tenant_id for RLS) ────────────
if os.getenv("SUPABASE_URL"):
    from ledger_app.middleware.tenant_context import TenantContextMiddleware
    app.add_middleware(TenantContextMiddleware)

for warning in optional_startup_warnings():
    _log.warning(warning)

# Warn about missing narrative LLM provider keys (pipeline skips absent stages gracefully)
try:
    from narrative_app.core.config import optional_provider_warnings
    for warning in optional_provider_warnings():
        _log.warning(warning)
except Exception:
    pass

_MAX_REQUEST_SIZE = int(os.getenv("MAX_REQUEST_SIZE_BYTES", str(10 * 1024 * 1024)))


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_REQUEST_SIZE:
        return JSONResponse(status_code=413, content={"detail": "Request too large"})
    return await call_next(request)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    auth_context = getattr(request.state, "auth_context", None)
    _log.info(
        "request_id=%s method=%s path=%s status=%s sub=%s tenant_id=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        getattr(auth_context, "sub", "-"),
        getattr(auth_context, "tenant_id", "-"),
    )
    return response


@app.exception_handler(OperationalError)
@app.exception_handler(ProgrammingError)
async def db_error_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "-")
    _log.error("request_id=%s db_error=%s", request_id, str(exc))
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ── Ledger routers (17) ────────────────────────────────────────────────────────
from ledger_app.api.audit import router as audit_router
from ledger_app.api.auth import protected_router as auth_protected_router
from ledger_app.api.auth import router as auth_router
from ledger_app.api.bundle import router as bundle_router
from ledger_app.api.calculate import router as calculate_router
from ledger_app.api.case_index import router as case_index_router
from ledger_app.api.cases import router as cases_router
from ledger_app.api.cbam import router as cbam_router
from ledger_app.api.db_check import router as db_check_router
from ledger_app.api.documents import router as documents_router
from ledger_app.api.extract import router as extract_router
from ledger_app.api.gaps import router as gaps_router
from ledger_app.api.health import router as health_router
from ledger_app.api.llama_test import router as llama_test_router
from ledger_app.api.report_package import router as report_package_router
from ledger_app.api.resolve import router as resolve_router
from ledger_app.api.review import router as review_router
from ledger_app.api.storage_check import router as storage_check_router

from app.core.health import router as deep_health_router
app.include_router(deep_health_router)
app.include_router(health_router, prefix="/api")
app.include_router(health_router)  # root /health + /ready (no prefix)
app.include_router(auth_router, prefix="/api")
app.include_router(auth_protected_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(db_check_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(storage_check_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(llama_test_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(cases_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(documents_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(case_index_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(extract_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(calculate_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(bundle_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(gaps_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(resolve_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(report_package_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(cbam_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(audit_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(review_router, prefix="/api", dependencies=[Depends(get_auth_context)])

# ── Narrative routers ─────────────────────────────────────────────────────────
# The pipeline router is replaced by app.api.narrative_pipeline which calls
# the ledger report package builder directly (no HTTP, no inter-service JWT).
from narrative_app.api.auth import protected_router as narrative_auth_protected_router
from narrative_app.api.auth import public_router as narrative_auth_public_router
from narrative_app.api.cbam_compliance import router as cbam_compliance_router
from narrative_app.api.jobs import router as jobs_router

from app.api.narrative_pipeline import router as narrative_pipeline_router

app.include_router(narrative_auth_public_router)
app.include_router(
    narrative_auth_protected_router, prefix="/api", dependencies=[Depends(get_auth_context)]
)
app.include_router(
    cbam_compliance_router, prefix="/api", dependencies=[Depends(get_auth_context)]
)
app.include_router(jobs_router, prefix="/api", dependencies=[Depends(get_auth_context)])
app.include_router(
    narrative_pipeline_router, prefix="/api", dependencies=[Depends(get_auth_context)]
)



@app.get("/")
def root():
    return {"service": "scope3-api", "status": "ok"}
