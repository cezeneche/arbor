from __future__ import annotations

import sys
import types

from fastapi import APIRouter

from . import _shared
from .cases import router as cases_router
from .classify import router as classify_router
from .documents import router as documents_router
from .drafts import router as drafts_router
from .emissions import router as emissions_router
from .report import router as report_router, get_cbam_report_package
from .explain import router as explain_router
from .reconcile import router as reconcile_router
from .insights import router as insights_router

router = APIRouter(prefix="/cbam", tags=["cbam"])
router.include_router(cases_router)
router.include_router(classify_router)
router.include_router(documents_router)
router.include_router(drafts_router)
router.include_router(emissions_router)
router.include_router(report_router)
router.include_router(explain_router)
router.include_router(reconcile_router)
router.include_router(insights_router)

__all__ = ["router", "get_cbam_report_package"]

# ---------------------------------------------------------------------------
# Re-export all names from _shared that tests may access directly via:
#   import ledger_app.api.cbam as cbam_api
#   cbam_api.engine = FakeEngine(...)            # direct assignment
#   monkeypatch.setattr(cbam_api, "engine", ...) # via pytest monkeypatch
#   cbam_api._document_sha256_from_extraction_snapshot(...)  # direct call
# ---------------------------------------------------------------------------

# Patchable names that tests set on this module (forwarded to _shared).
_PATCHABLE = {
    "engine",
    "CBAM_STORAGE_ROOT",
    "extract_cbam_document",
    "extract_document_from_upload",
    "LlamaOrchestrator",
    "ingest_orchestrator",
    "arbitrate_parsed_invoice",
    "repair_parsed_invoice",
    "compare_extractions",
    "bytes_sha256_hex",
    "get_snapshot_store",
}

# Expose current values from _shared so attribute lookups work immediately.
engine = _shared.engine
CBAM_STORAGE_ROOT = _shared.CBAM_STORAGE_ROOT
extract_cbam_document = _shared.extract_cbam_document
extract_document_from_upload = _shared.extract_document_from_upload
LlamaOrchestrator = _shared.LlamaOrchestrator
ingest_orchestrator = _shared.ingest_orchestrator
arbitrate_parsed_invoice = _shared.arbitrate_parsed_invoice
repair_parsed_invoice = _shared.repair_parsed_invoice
compare_extractions = _shared.compare_extractions
bytes_sha256_hex = _shared.bytes_sha256_hex
get_snapshot_store = _shared.get_snapshot_store

# Also expose private helpers that tests call directly on this module.
_document_sha256_from_extraction_snapshot = _shared._document_sha256_from_extraction_snapshot


class _CbamPackageModule(types.ModuleType):
    """Module wrapper that forwards attribute assignment to _shared.

    When tests do ``cbam_api.engine = FakeEngine(...)`` the assignment is
    forwarded to ``_shared.engine`` so that route handlers (which read
    attributes from ``_shared`` at call time) pick up the patched value.
    """

    def __setattr__(self, name: str, value: object) -> None:
        # Always update ourselves.
        super().__setattr__(name, value)
        # Forward patchable names to _shared so sub-modules see the patch.
        if name in _PATCHABLE:
            object.__setattr__(_shared, name, value)


# Replace this module in sys.modules with the wrapper instance.
_this = sys.modules[__name__]
_wrapper = _CbamPackageModule(__name__)
_wrapper.__dict__.update(_this.__dict__)
# Keep _PATCHABLE accessible on the wrapper.
_wrapper._PATCHABLE = _PATCHABLE  # type: ignore[attr-defined]
sys.modules[__name__] = _wrapper
