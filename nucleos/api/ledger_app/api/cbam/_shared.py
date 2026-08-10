"""Backward-compatible re-export shim.

All logic has been moved to focused sub-modules:
  schemas.py       — Pydantic models, enums, constants
  db_helpers.py    — DB utility functions
  audit_helpers.py — Audit and snapshot functions
  payload_builders.py — Payload builder functions

Callers that import `from . import _shared` and access `_shared.foo` continue
to work without modification because every public and private name is re-exported
here.  New code should import directly from the relevant sub-module.
"""
from __future__ import annotations

# ── External service imports re-exported for callers ──────────────────────────
from ledger_app.core.crypto import decrypt_field, encrypt_field  # noqa: F401
from ledger_app.db.rls import set_tenant_context  # noqa: F401
from ledger_app.db.session import engine  # noqa: F401
from ledger_app.schemas.evidence import EvidenceAtom  # noqa: F401
from ledger_app.services.cbam_arbiter import arbitrate_parsed_invoice  # noqa: F401
from ledger_app.services.cbam_calculation_service import compute_cbam_liability  # noqa: F401
from ledger_app.services.cbam_carbon_pricing import (  # noqa: F401
    get_all_recognised_schemes,
    lookup_carbon_pricing_scheme,
)
from ledger_app.services.cbam_data_quality import evaluate_cbam_data_quality  # noqa: F401
from ledger_app.services.cbam_emission_factors import (  # noqa: F401
    TABLE_VERSION as FACTOR_TABLE_VERSION,
    compute_see_from_defaults,
    validate_against_defaults,
)
from ledger_app.services.cbam_explain import explain_field, explain_metric  # noqa: F401
from ledger_app.services.cbam_extractor import extract as extract_cbam_document  # noqa: F401
from ledger_app.services.cbam_installation_registry import validate_installation_id  # noqa: F401
from ledger_app.services.cbam_repair import repair_parsed_invoice  # noqa: F401
from ledger_app.services.cbam_scope import ScopeStatus, determine_cbam_scope  # noqa: F401
from ledger_app.services.cbam_taric import CBAMCodeNotInScope, lookup_sector  # noqa: F401
from ledger_app.services.llama_structured_extractor import compare_extractions  # noqa: F401
from ledger_app.services.snapshot_store import (  # noqa: F401
    bytes_sha256_hex,
    canonical_json,
    get_snapshot_store,
    sha256_hex,
)

# ── Sub-module re-exports ──────────────────────────────────────────────────────
from .schemas import (  # noqa: F401
    ALLOWED_EMISSIONS_METHODS,
    CBAM_STORAGE_ROOT,
    CBAMCaseCreate,
    CBAMDraftFromParsedInvoiceRequest,
    CBAMEmissionsCreate,
    CBAMGoodsLineCreate,
    CBAMLiabilityRequest,
    CBAMScopeCheckRequest,
    CBAMShipmentCreate,
    CaseJurisdiction,
    EmissionsMethod,
    ParsedInvoiceEmissions,
    ParsedInvoiceImporter,
    ParsedInvoiceLine,
    ParsedInvoiceMetadata,
)
from .db_helpers import (  # noqa: F401
    _ALLOWED_CBAM_TABLES,
    _bad_request,
    _coerce_float,
    _enforce_tenant_id,
    _infer_sector_from_cn_code,
    _line_fingerprint,
    _manual_fk_check,
    _needs_explicit_value,
    _normalize_line_mass,
    _normalize_line_text,
    _parse_iso_date,
    _pick_existing,
    _quarter_from_date,
    _require_case_tenant,
    _resolve_case_for_goods_line,
    _resolve_case_for_shipment,
    _table_columns,
)
from .audit_helpers import (  # noqa: F401
    _append_llm_evidence,
    _document_sha256_from_extraction_snapshot,
    _evidence_documents_from_snapshot,
    _extraction_evidence_summary,
    _normalized_evidence,
    _safe_snapshot_write,
    _write_audit_event,
    snapshot_cbam_compliance_pack,
)
from .payload_builders import (  # noqa: F401
    _build_case_shipments_payload,
    _build_case_summary,
    _build_parsed_invoice_request_from_extraction,
    _insert_returning,
    _llama_candidate_from_structured_invoice,
    _parsed_data_quality_precheck_from_payload,
    _report_package_audit_block,
)
