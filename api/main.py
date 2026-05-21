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

from pathlib import Path

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError, ProgrammingError

from ledger_app.core.config import AppConfig, optional_startup_warnings, validate_startup_config

# ── Standard Python logging → stdout (readable in Supabase logs + any cloud) ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler()],
)
logging.root.setLevel(logging.INFO)

_sentry_dsn = os.getenv("SENTRY_DSN_API")
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        environment=os.getenv("ENVIRONMENT", "development"),
        traces_sample_rate=0.2,
        send_default_pii=False,
    )

validate_startup_config()

_log = logging.getLogger("nucleos")


# ── Supabase client lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ────────────────────────────────────────────────────────────────
    if AppConfig.supabase_enabled():
        try:
            from ledger_app.db.supabase_client import init_clients
            await init_clients()
            _log.info("Supabase clients initialised")
        except Exception as exc:
            _log.warning("Supabase client init failed (non-fatal): %s", exc)

    # Recover cases stuck in "processing" from a previous server run.
    # If the server restarted mid-pipeline the background task is gone but the
    # case row stays "processing" and will never resolve on its own.
    try:
        from ledger_app.api.cbam._shared import engine as _cbam_engine
        from sqlalchemy import text as _text
        _timeout = int(os.getenv("PIPELINE_TIMEOUT_SECONDS", "180"))
        with _cbam_engine.begin() as _conn:
            cols_row = _conn.execute(_text(
                "SELECT column_name FROM information_schema.columns"
                " WHERE table_schema='cbam' AND table_name='cbam_cases'"
            )).mappings().all()
            cols = {r["column_name"] for r in cols_row}
            extra = ""
            if "processing_stage" in cols:
                extra += ", processing_stage = 'failed'"
            if "processing_error" in cols:
                extra += ", processing_error = 'Server restarted before extraction completed'"
            result = _conn.execute(
                _text(
                    f"UPDATE cbam.cbam_cases"
                    f" SET status = 'error'{extra}"
                    f" WHERE status = 'processing'"
                    f" AND created_at < NOW() - INTERVAL '1 second' * :timeout"
                ),
                {"timeout": _timeout},
            )
        if result.rowcount:
            _log.warning("startup_recovery: marked %d stuck processing case(s) as error", result.rowcount)
    except Exception as exc:
        _log.warning("startup_recovery: failed (non-fatal): %s", exc)

    # Warm up PaddleOCR so the first document upload doesn't pay the 30-60s init cost.
    try:
        import threading
        def _warmup_ocr() -> None:
            try:
                from ledger_app.services.document_text_extractor import _get_paddle_ocr
                _get_paddle_ocr()
                _log.info("paddleocr: model warmed up")
            except Exception as exc:
                _log.warning("paddleocr: warmup failed (non-fatal): %s", exc)
        threading.Thread(target=_warmup_ocr, daemon=True).start()
    except Exception as exc:
        _log.warning("paddleocr: warmup thread failed to start: %s", exc)

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

    # ── APScheduler — monthly registration threshold check ────────────────────
    # Runs on day=1 of each month at 01:00 UTC.
    # Uses BackgroundScheduler (thread-based) so that the synchronous
    # SQLAlchemy engine calls do not block the asyncio event loop.
    _scheduler = None
    if AppConfig.registration_scheduler_enabled():
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.cron import CronTrigger
            from app.services.registration_manager import run_monthly_threshold_check
            from ledger_app.api.cbam._shared import engine as _cbam_engine

            def _monthly_check_job() -> None:
                try:
                    summary = run_monthly_threshold_check(_cbam_engine)
                    _log.info("monthly_threshold_check: %s", summary)
                except Exception as exc:
                    _log.error("monthly_threshold_check: unhandled error: %s", exc)

            _scheduler = BackgroundScheduler(timezone="UTC")
            _scheduler.add_job(
                _monthly_check_job,
                CronTrigger(day=1, hour=1, minute=0, timezone="UTC"),
                id="monthly_registration_check",
                replace_existing=True,
                misfire_grace_time=3600,  # run up to 1 h late if server was down
            )
            _scheduler.start()
            _log.info(
                "registration_scheduler: started (next run: %s)",
                _scheduler.get_job("monthly_registration_check").next_run_time,
            )
        except Exception as exc:
            _log.warning("registration_scheduler: failed to start (non-fatal): %s", exc)

    yield

    # ── Shutdown ───────────────────────────────────────────────────────────────
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
            _log.info("registration_scheduler: shut down")
        except Exception:
            pass

    if AppConfig.supabase_enabled():
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
if AppConfig.force_https():
    from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
    app.add_middleware(HTTPSRedirectMiddleware)

# ── Tenant context middleware (sets app.current_tenant_id for RLS) ────────────
if AppConfig.supabase_enabled():
    from ledger_app.middleware.tenant_context import TenantContextMiddleware
    app.add_middleware(TenantContextMiddleware)

for warning in optional_startup_warnings():
    _log.warning(warning)

# Warn about missing narrative LLM key
if not AppConfig.narrative_enabled():
    _log.warning("ANTHROPIC_API_KEY is not set; narrative pipeline will fail.")

_MAX_REQUEST_SIZE = AppConfig.max_request_size_bytes()


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


# ── Routers (core + ledger + platform) ───────────────────────────────────────
from app.routers import register_all as _register_all
_register_all(app)


# ── Static files + public tool page ───────────────────────────────────────────
_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

_CBAM_CHECKER_HTML = _STATIC_DIR / "cbam-checker.html"


@app.get("/tools/cbam-checker", response_class=HTMLResponse, include_in_schema=False)
def cbam_checker_page() -> HTMLResponse:
    """Serve the free public CBAM scope checker tool."""
    if not _CBAM_CHECKER_HTML.exists():
        return HTMLResponse(content="Tool page not found", status_code=404)
    return HTMLResponse(content=_CBAM_CHECKER_HTML.read_text(encoding="utf-8"))


@app.get("/")
def root():
    return {"service": "scope3-api", "status": "ok"}
