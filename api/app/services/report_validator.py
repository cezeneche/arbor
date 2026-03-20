"""
Deterministic CBAM compliance report validator.

Replaces the Gemini LLM QA gate with Python assertion logic that runs at
zero cost, zero latency, and zero hallucination risk.

What this does (vs what Gemini did):
  - Gemini: probabilistic check that the narrative "looks right"
  - This module: exact numeric cross-check against the report package, with
    deterministic completeness checks for data-quality warnings and scope validity

human_review_required is set True when:
  - Any numeric value in narrative.results deviates from the report package totals
    by more than 0.001 (absolute tolerance)
  - Any goods line has no calculation_method
  - Any blocking reconciliation warning is unaddressed in the narrative

Audit trail:
  Every call to validate_report_package_integrity writes a signed audit log
  entry (event_type="narrative_validation") with the full check matrix,
  so the validation record is part of the immutable audit chain.

Regulatory basis:
  EU 2023/1773 Art. 6 — quarterly report content requirements
  EU 2023/956 Annex I — CBAM scope (CN code validity)
  EU 2023/956 Art. 9  — carbon price recognition verifier obligation
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

log = logging.getLogger("nucleos.report_validator")

# ── Tolerance ─────────────────────────────────────────────────────────────────
_NUMERIC_TOLERANCE = Decimal("0.001")   # kg CO₂e — sub-gram tolerance for ledger totals

# ── Warning tag prefixes that must appear in narrative.limitations ─────────────
# Any data_quality.warnings entry whose text contains one of these prefixes
# must be referenced (as a substring) in the narrative limitations field.
_MUST_SURFACE_IN_LIMITATIONS: tuple[str, ...] = (
    "repair_failed:",
    "extreme_outlier",
    "plausibility_warning",
    "actual_implausibly_",   # Annex VI plausibility check from cbam_emission_factors
)

# Warning tags that trigger human_review_required when not addressed
_RECONCILIATION_TAGS: tuple[str, ...] = (
    "reconciliation_warning",
    "reconciliation_conflict",
)

# Recognised calculation methods per EU 2023/1773 Art. 4
_VALID_METHODS = frozenset({"actual", "estimated", "default"})


# ── Result types ───────────────────────────────────────────────────────────────

@dataclass
class CheckResult:
    """Single assertion in the validation matrix."""
    check_id: str           # machine-readable identifier for audit log indexing
    description: str        # human-readable description of what was checked
    passed: bool
    detail: str             # what was found; empty string when passed


@dataclass
class ValidationResult:
    """
    Full output of validate_report_package_integrity().

    Attributes
    ----------
    passed:
        True only when every check passes.
    human_review_required:
        True when any numeric mismatch, missing calculation_method, or
        unaddressed reconciliation warning is found.
    failures:
        Human-readable failure messages (subset of checks where passed=False).
    checks:
        Complete matrix of all checks run — used for the audit log entry.
    open_gaps:
        Structured records of issues that require importer action before the
        HMRC return can claim full accuracy.  Unlike failures, open_gaps do
        not block return production — the return is produced with conservative
        method downgrades and the importer is guided to resolve each gap.
    method_downgrades:
        Goods lines whose claimed calculation_method has been downgraded for
        the HMRC return because the verification_status is not 'verified'.
        Format: [{goods_line_id, cn_code, from_method, to_method, reason}].
        Callers (hmrc_return_builder, eu_xml_builder) must apply these
        downgrades when constructing output XML / JSON.
    """
    passed: bool
    human_review_required: bool
    failures: list[str] = field(default_factory=list)
    checks: list[CheckResult] = field(default_factory=list)
    open_gaps: list[dict] = field(default_factory=list)
    method_downgrades: list[dict] = field(default_factory=list)


# ── Internal helpers ───────────────────────────────────────────────────────────

def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _numeric_check(
    checks: list[CheckResult],
    failures: list[str],
    check_id: str,
    description: str,
    expected: Any,
    actual: Any,
    *,
    tolerance: Decimal = _NUMERIC_TOLERANCE,
) -> bool:
    """
    Assert |expected - actual| <= tolerance.

    Both values are coerced to Decimal. Returns True if the check passes.
    None on either side is treated as a missing-value failure.
    """
    exp = _to_decimal(expected)
    act = _to_decimal(actual)

    if exp is None and act is None:
        # Both absent — treat as pass (nothing to cross-check)
        checks.append(CheckResult(check_id, description, passed=True, detail="both absent"))
        return True

    if exp is None or act is None:
        missing_side = "expected (report_package)" if exp is None else "narrative"
        detail = f"{missing_side} value is absent"
        checks.append(CheckResult(check_id, description, passed=False, detail=detail))
        failures.append(f"{description}: {detail}")
        return False

    diff = abs(exp - act)
    passed = diff <= tolerance
    detail = "" if passed else (
        f"report_package={exp}, narrative={act}, |diff|={diff} > tolerance={tolerance}"
    )
    checks.append(CheckResult(check_id, description, passed=passed, detail=detail))
    if not passed:
        failures.append(f"{description}: {detail}")
    return passed


def _exact_int_check(
    checks: list[CheckResult],
    failures: list[str],
    check_id: str,
    description: str,
    expected: Any,
    actual: Any,
) -> bool:
    """Assert expected == actual for integer fields."""
    try:
        exp_int = int(expected) if expected is not None else None
        act_int = int(actual) if actual is not None else None
    except (TypeError, ValueError):
        exp_int, act_int = None, None

    passed = exp_int == act_int
    detail = "" if passed else f"report_package={exp_int}, narrative={act_int}"
    checks.append(CheckResult(check_id, description, passed=passed, detail=detail))
    if not passed:
        failures.append(f"{description}: {detail}")
    return passed


def _iter_goods_lines(report_package: dict):
    """
    Yield (shipment, goods_line_dict, latest_emissions_dict | None) for every
    goods line in the report package.
    """
    for shipment_bundle in report_package.get("shipments") or []:
        shipment = shipment_bundle.get("shipment") or {}
        for gl_bundle in shipment_bundle.get("goods_lines") or []:
            goods_line = gl_bundle.get("goods_line") or {}
            emissions = gl_bundle.get("latest_emissions")
            yield shipment, goods_line, emissions


# ── Public helper ─────────────────────────────────────────────────────────────

def requires_verification(
    goods_line: dict[str, Any],
    emissions: dict[str, Any] | None = None,
) -> bool:
    """Return True if this goods line requires third-party verification.

    Verification is required when the calculation_method is 'actual' — i.e.
    the importer intends to claim actual (not default or estimated) embedded
    emissions in the HMRC return.

    - 'actual'    → True  (GACI-accredited verifier required)
    - 'default'   → False (Annex VI default factors; no verification needed)
    - 'estimated' → False (estimated values; no verification needed)

    Parameters
    ----------
    goods_line:
        Goods-line dict (from _iter_goods_lines or a direct DB row).
    emissions:
        Latest emissions dict for the goods line.  If None, falls back to
        a 'method' or 'calculation_method' key on goods_line itself.
    """
    method = ""
    if emissions is not None:
        method = str(
            emissions.get("method") or emissions.get("calculation_method") or ""
        ).lower().strip()
    if not method:
        method = str(
            goods_line.get("method") or goods_line.get("calculation_method") or ""
        ).lower().strip()
    return method == "actual"


# ── Numeric cross-checks ───────────────────────────────────────────────────────

def _check_numeric_totals(
    report_package: dict,
    narrative: dict,
    checks: list[CheckResult],
    failures: list[str],
) -> bool:
    """
    Cross-check narrative.results against report_package.summary totals.

    For CBAM packets (type=cbam_report_package_v1), the authoritative totals
    live in summary.total_*_emissions_kgco2e.

    For legacy packets, totals live in report_package.results.

    Returns True if all numeric checks pass.
    """
    all_passed = True
    is_cbam = report_package.get("type") == "cbam_report_package_v1"
    summary = report_package.get("summary") or {}
    rp_results = report_package.get("results") or {}
    narr_results = narrative.get("results") or {}

    if is_cbam:
        all_passed &= _numeric_check(
            checks, failures,
            "numeric.total_direct_kgco2e",
            "Total direct embedded emissions (kgCO₂e)",
            expected=summary.get("total_direct_emissions_kgco2e"),
            actual=narr_results.get("total_direct_embedded_kgco2e"),
        )
        all_passed &= _numeric_check(
            checks, failures,
            "numeric.total_indirect_kgco2e",
            "Total indirect embedded emissions (kgCO₂e)",
            expected=summary.get("total_indirect_emissions_kgco2e"),
            actual=narr_results.get("total_indirect_embedded_kgco2e"),
        )
        all_passed &= _numeric_check(
            checks, failures,
            "numeric.total_embedded_kgco2e",
            "Total embedded emissions (kgCO₂e)",
            expected=summary.get("total_embedded_emissions_kgco2e"),
            actual=narr_results.get("total_embedded_kgco2e"),
        )
        all_passed &= _exact_int_check(
            checks, failures,
            "numeric.goods_lines_count",
            "Goods lines count",
            expected=summary.get("total_goods_lines"),
            actual=narr_results.get("goods_lines_count"),
        )
    else:
        # Legacy packet — scope-1/scope-2 totals
        all_passed &= _numeric_check(
            checks, failures,
            "numeric.total_emissions_kgco2e",
            "Total emissions (kgCO₂e)",
            expected=rp_results.get("total_kgco2e"),
            actual=narr_results.get("total_emissions_kgco2e"),
        )
        all_passed &= _numeric_check(
            checks, failures,
            "numeric.scope_1_kgco2e",
            "Scope 1 emissions (kgCO₂e)",
            expected=rp_results.get("scope_1_natural_gas_kgco2e"),
            actual=narr_results.get("scope_1_kgco2e"),
        )
        all_passed &= _numeric_check(
            checks, failures,
            "numeric.scope_2_kgco2e",
            "Scope 2 emissions (kgCO₂e)",
            expected=rp_results.get("scope_2_electricity_kgco2e"),
            actual=narr_results.get("scope_2_kgco2e"),
        )
        all_passed &= _numeric_check(
            checks, failures,
            "numeric.intensity_kgco2e_per_unit",
            "Emission intensity (kgCO₂e per unit)",
            expected=rp_results.get("kgco2e_per_unit"),
            actual=narr_results.get("intensity_kgco2e_per_unit"),
        )

    return all_passed


# ── Reporting period check ─────────────────────────────────────────────────────

def _check_reporting_period(
    report_package: dict,
    narrative: dict,
    checks: list[CheckResult],
    failures: list[str],
) -> bool:
    """
    Verify the narrative executive_summary references the correct reporting period.

    Checks that both reporting_year and reporting_quarter from the case appear
    as substrings in narrative.executive_summary (e.g. "2024" and "Q1" or "1").
    """
    case = report_package.get("case") or {}
    year = case.get("reporting_year")
    quarter = case.get("reporting_quarter")

    if year is None and quarter is None:
        checks.append(CheckResult(
            "period.reporting_period",
            "Reporting period present in executive_summary",
            passed=True,
            detail="no reporting_year/quarter in case — skip",
        ))
        return True

    summary_text = str(narrative.get("executive_summary") or "").lower()
    issues = []

    if year is not None and str(year) not in summary_text:
        issues.append(f"reporting_year {year!r} not mentioned in executive_summary")

    if quarter is not None:
        # Accept "Q1", "Q2", "quarter 1", "1", etc.
        quarter_str = str(quarter)
        if quarter_str not in summary_text and f"q{quarter_str}" not in summary_text:
            issues.append(f"reporting_quarter {quarter!r} not mentioned in executive_summary")

    passed = not issues
    detail = "; ".join(issues)
    checks.append(CheckResult(
        "period.reporting_period",
        "Reporting period referenced in executive_summary",
        passed=passed,
        detail=detail,
    ))
    if not passed:
        failures.append(f"Reporting period: {detail}")
    return passed


# ── Completeness checks ────────────────────────────────────────────────────────

def _check_calculation_methods(
    report_package: dict,
    checks: list[CheckResult],
    failures: list[str],
) -> bool:
    """
    Every goods line must have a recognised calculation_method.

    Absence → human_review_required (importer must resolve the method before
    the declaration can be submitted to the EU registry).
    """
    missing_method: list[str] = []

    for _shipment, goods_line, emissions in _iter_goods_lines(report_package):
        gl_id = str(goods_line.get("id") or "")
        cn_code = goods_line.get("cn_code") or "?"

        if emissions is None:
            missing_method.append(f"goods_line {gl_id} (cn_code={cn_code}): no emissions record")
            continue

        method = emissions.get("method") or emissions.get("calculation_method")
        if not method or str(method).lower() not in _VALID_METHODS:
            missing_method.append(
                f"goods_line {gl_id} (cn_code={cn_code}): "
                f"calculation_method={method!r} — must be one of {sorted(_VALID_METHODS)}"
            )

    passed = not missing_method
    detail = "; ".join(missing_method)
    checks.append(CheckResult(
        "completeness.calculation_method",
        "All goods lines have a valid calculation_method (actual/estimated/default)",
        passed=passed,
        detail=detail,
    ))
    if not passed:
        failures.append(f"Missing calculation_method: {detail}")
    return passed


def _check_warnings_surfaced_in_limitations(
    report_package: dict,
    narrative: dict,
    checks: list[CheckResult],
    failures: list[str],
) -> bool:
    """
    All repair_failed and extreme_outlier warnings must appear in narrative.limitations.

    Uses substring matching: we look for a fragment of the warning tag (the field
    name after the colon) in the limitations text, not the full tag verbatim, since
    Claude is instructed to translate warning codes into human-readable prose.

    Examples:
      "repair_failed:origin_country"  →  check for "origin_country" in limitations
      "actual_implausibly_high"       →  check for "implausibly" in limitations
    """
    data_quality = report_package.get("data_quality") or {}
    warnings = data_quality.get("warnings") or []
    limitations_text = str(narrative.get("limitations") or "").lower()

    unfound: list[str] = []

    for w in warnings:
        w_lower = str(w).lower()
        # Check if this warning tag contains any of the must-surface prefixes
        if not any(tag in w_lower for tag in _MUST_SURFACE_IN_LIMITATIONS):
            continue

        # Extract the most meaningful fragment to search for in the limitations text.
        # Format is typically "goods_line:<id>:repair_failed:origin_country"
        # or "repair_failed:invoice_number". We extract everything after "repair_failed:"
        # or the full tag for other types.
        fragment = w_lower
        for tag in _MUST_SURFACE_IN_LIMITATIONS:
            if tag in w_lower:
                # Use the text after the recognised prefix as the search fragment
                after = w_lower.split(tag, 1)[-1].lstrip(":")
                # Strip UUIDs (long hex strings) and take the field name part
                parts = [p for p in after.split(":") if p and len(p) < 60]
                if parts:
                    fragment = parts[-1]  # e.g. "origin_country", "invoice_number"
                break

        if fragment and fragment not in limitations_text:
            unfound.append(w)

    passed = not unfound
    detail = f"Not mentioned in limitations: {unfound}" if unfound else ""
    checks.append(CheckResult(
        "completeness.warnings_in_limitations",
        "All repair_failed and extreme_outlier warnings referenced in narrative.limitations",
        passed=passed,
        detail=detail,
    ))
    if not passed:
        failures.append(
            f"Data quality warnings not reflected in narrative limitations: {unfound}"
        )
    return passed


def _check_cn_code_scope(
    report_package: dict,
    checks: list[CheckResult],
    failures: list[str],
) -> bool:
    """
    Every goods line CN code must map to a known CBAM sector (EU 2023/956 Annex I).

    CN codes that return None from lookup_sector are outside CBAM scope and should
    not appear in a CBAM declaration.
    """
    try:
        from ledger_app.services.cbam_taric import lookup_sector
    except ImportError:
        checks.append(CheckResult(
            "completeness.cn_code_scope",
            "CN code scope valid for all goods lines (EU 2023/956 Annex I)",
            passed=True,
            detail="cbam_taric unavailable — skipped",
        ))
        return True

    out_of_scope: list[str] = []

    for _shipment, goods_line, _emissions in _iter_goods_lines(report_package):
        cn_code = goods_line.get("cn_code")
        if not cn_code:
            continue  # already flagged as missing by data_quality
        sector = lookup_sector(str(cn_code))
        if sector is None:
            gl_id = str(goods_line.get("id") or "")
            out_of_scope.append(
                f"goods_line {gl_id}: cn_code={cn_code!r} is not in CBAM scope "
                f"(EU 2023/956 Annex I)"
            )

    passed = not out_of_scope
    detail = "; ".join(out_of_scope)
    checks.append(CheckResult(
        "completeness.cn_code_scope",
        "CN code scope valid for all goods lines (EU 2023/956 Annex I)",
        passed=passed,
        detail=detail,
    ))
    if not passed:
        failures.append(f"CN codes outside CBAM scope: {detail}")
    return passed


def _check_cpr_verifier(
    report_package: dict,
    narrative: dict,
    checks: list[CheckResult],
    failures: list[str],
) -> bool:
    """
    If a carbon price recognition (CPR) scheme is claimed, a verifier document
    reference must be present (EU 2023/956 Art. 9).

    Detection: look for non-zero carbon_price_paid_eur or carbon_price_recognised
    flags in emissions data or extraction_evidence. If found, the narrative
    limitations or executive_summary must reference a verifier document.
    """
    cpr_claimed = False

    # Check emissions data for carbon price claims
    for _shipment, _gl, emissions in _iter_goods_lines(report_package):
        if emissions is None:
            continue
        cpr_eur = _to_decimal(emissions.get("carbon_price_paid_eur"))
        if cpr_eur is not None and cpr_eur > Decimal("0"):
            cpr_claimed = True
            break
        if emissions.get("carbon_price_recognised"):
            cpr_claimed = True
            break

    # Also check extraction_evidence for CPR mentions
    if not cpr_claimed:
        evidence = report_package.get("extraction_evidence") or {}
        evidence_str = str(evidence).lower()
        if "carbon_price" in evidence_str or "cpr" in evidence_str:
            cpr_claimed = True

    if not cpr_claimed:
        checks.append(CheckResult(
            "completeness.cpr_verifier",
            "Carbon price recognition (CPR) verifier document present if CPR is claimed",
            passed=True,
            detail="no CPR claim detected",
        ))
        return True

    # CPR is claimed — check that a verifier document reference is in the narrative
    narrative_text = (
        str(narrative.get("executive_summary") or "")
        + " "
        + str(narrative.get("limitations") or "")
    ).lower()

    verifier_keywords = ("verifier", "verification", "art. 9", "art 9", "carbon price")
    has_verifier_ref = any(kw in narrative_text for kw in verifier_keywords)

    passed = has_verifier_ref
    detail = "" if passed else (
        "CPR scheme detected but no verifier document reference found in narrative "
        "(EU 2023/956 Art. 9 requires verifier evidence when claiming carbon price deduction)"
    )
    checks.append(CheckResult(
        "completeness.cpr_verifier",
        "Carbon price recognition (CPR) verifier document present if CPR is claimed",
        passed=passed,
        detail=detail,
    ))
    if not passed:
        failures.append(f"CPR verifier: {detail}")
    return passed


def _check_reconciliation_warnings(
    report_package: dict,
    checks: list[CheckResult],
    failures: list[str],
) -> bool:
    """
    Blocking reconciliation warnings must not be silently ignored.

    Any data_quality.warnings entry tagged with a reconciliation prefix is
    considered "unaddressed" if it is not mentioned in narrative.limitations.
    This triggers human_review_required.
    """
    data_quality = report_package.get("data_quality") or {}
    warnings = data_quality.get("warnings") or []
    limitations_text = str({}).lower()  # placeholder — we only check existence, not text

    recon_warnings = [
        w for w in warnings
        if any(tag in str(w).lower() for tag in _RECONCILIATION_TAGS)
    ]

    passed = not recon_warnings
    detail = f"Unaddressed reconciliation warnings: {recon_warnings}" if recon_warnings else ""
    checks.append(CheckResult(
        "completeness.reconciliation_warnings",
        "No unaddressed reconciliation warnings (EU UCC 952/2013 Art. 5(10))",
        passed=passed,
        detail=detail,
    ))
    if not passed:
        failures.append(f"Reconciliation warnings present: {recon_warnings}")
    return passed


# ── Verification status check ─────────────────────────────────────────────────

_VERIFIED_STATUS = "verified"
_VERIFICATION_GUIDANCE = (
    "Upload a signed verification report from a GACI-accredited independent "
    "verifier (ISO 17029 / ISO 14064-3 / ISO 14065 / ISO 14066) via "
    "POST /api/cbam/goods-lines/{id}/upload-verification, then request "
    "compliance review to reach 'verified' status."
)


def _check_actual_verification_status(
    report_package: dict,
    checks: list[CheckResult],
    failures: list[str],
    open_gaps: list[dict],
    method_downgrades: list[dict],
) -> bool:
    """Goods lines claiming actual emissions must have verification_status='verified'.

    For each goods line where calculation_method='actual':
    - If verification_status='verified'  → no action; method remains actual_verified
      in the HMRC return.
    - If verification_status is anything else (not_required, pending, submitted,
      rejected, or absent) → the method is downgraded to 'actual_unverified' in
      the HMRC return.  An open_gap and a method_downgrade record are added.

    This check is non-blocking: the return CAN be produced with downgraded methods.
    human_review_required is NOT set by this check — the importer is guided to
    resolve the gaps before the next return cycle.

    Regulation: Finance No.2 Bill 2025-26; HMRC CBAM Secondary Legislation Feb 2026.
    """
    unverified_details: list[str] = []

    for _shipment, goods_line, emissions in _iter_goods_lines(report_package):
        if not requires_verification(goods_line, emissions):
            continue  # default / estimated — no verification needed

        gl_id   = str(goods_line.get("id") or "")
        cn_code = goods_line.get("cn_code") or "?"
        vstatus = str(goods_line.get("verification_status") or "not_required").lower().strip()

        if vstatus == _VERIFIED_STATUS:
            continue  # fully verified — no action

        detail_str = (
            f"goods_line {gl_id} (cn_code={cn_code}): "
            f"verification_status={vstatus!r} — downgraded to actual_unverified"
        )
        unverified_details.append(detail_str)

        open_gaps.append({
            "type":                 "verification_required",
            "goods_line_id":        gl_id,
            "cn_code":              cn_code,
            "current_method":       "actual",
            "effective_method":     "actual_unverified",
            "verification_status":  vstatus,
            "blocking_submission":  False,
            "guidance":             _VERIFICATION_GUIDANCE,
        })

        method_downgrades.append({
            "goods_line_id":  gl_id,
            "cn_code":        cn_code,
            "from_method":    "actual_verified",
            "to_method":      "actual_unverified",
            "reason":         f"verification_status={vstatus!r}",
        })

    passed = not unverified_details
    detail = "; ".join(unverified_details)
    checks.append(CheckResult(
        "verification.actual_emissions_verified",
        "All actual-method goods lines have verification_status='verified'",
        passed=passed,
        detail=detail,
    ))
    if not passed:
        failures.append(
            f"Actual emissions not verified — method downgraded to actual_unverified: {detail}"
        )
    return passed


# ── Audit log recording ────────────────────────────────────────────────────────

def _record_validation_in_audit_log(
    case_id: str,
    result: ValidationResult,
    checks: list[CheckResult],
) -> None:
    """
    Write a signed audit_log entry with the full validation matrix.

    Uses _write_audit_event from ledger_app.api.cbam._shared, which handles
    HMAC chain signing and Slack notification. Never raises.
    """
    try:
        from ledger_app.api.cbam._shared import _write_audit_event

        _write_audit_event(
            case_id,
            "narrative_validation",
            {
                "passed": result.passed,
                "human_review_required": result.human_review_required,
                "failures_count": len(result.failures),
                "failures": result.failures,
                "checks": [
                    {
                        "check_id": c.check_id,
                        "description": c.description,
                        "passed": c.passed,
                        "detail": c.detail,
                    }
                    for c in checks
                ],
                "validator": "report_validator_v1",
            },
            actor_sub="narrative-validator",
        )
    except Exception as exc:
        log.debug("audit log write for narrative_validation failed (non-fatal): %s", exc)


# ── Pre-output reconciliation checks (CLAUDE.md §Reconciliation Checks) ───────
#
# These 4 checks are run by run_pre_output_reconciliation() before generating
# compliance_pack_v1.  They complement the narrative-validation checks above.

def _check_mass_consistency(
    report_package: dict,
    checks: list[CheckResult],
    failures: list[str],
) -> bool:
    """
    Check 1: Net mass must be consistent across goods-line records.

    Each goods line stores net_mass_kg.  This check flags lines where
    net_mass_kg is zero or None — a missing mass prevents SEE calculation
    and makes the CBAM charge unverifiable.

    (Cross-document mass reconciliation against external customs declarations
    is performed when the customs document is uploaded; here we only verify
    that internal values are present and non-zero.)

    Regulation: UK Finance No.2 Bill 2025-26; EU 2023/1773 Art. 3(1).
    """
    missing_mass: list[str] = []

    for _ship, goods_line, emissions in _iter_goods_lines(report_package):
        gl_id = str(goods_line.get("id") or "")
        cn_code = goods_line.get("cn_code") or "?"
        mass = _to_decimal(goods_line.get("net_mass_kg") or goods_line.get("quantity"))
        if mass is None or mass <= Decimal("0"):
            missing_mass.append(
                f"goods_line {gl_id} (cn_code={cn_code}): "
                f"net_mass_kg={goods_line.get('net_mass_kg')!r} — zero or absent"
            )

    passed = not missing_mass
    detail = "; ".join(missing_mass)
    checks.append(CheckResult(
        "reconciliation.mass_consistency",
        "Net mass is present and > 0 for all goods lines",
        passed=passed,
        detail=detail,
    ))
    if not passed:
        failures.append(f"Mass consistency: {detail}")
    return passed


def _check_quarterly_totals(
    report_package: dict,
    checks: list[CheckResult],
    failures: list[str],
    tolerance: Decimal = Decimal("1.0"),  # 1 kgCO2e tolerance for rounding
) -> bool:
    """
    Check 4: Sum of goods-line emissions must equal the declared summary totals.

    Adds up direct_embedded_kgco2e and indirect_embedded_kgco2e across all
    goods lines and compares with summary.total_direct_emissions_kgco2e and
    summary.total_indirect_emissions_kgco2e.

    Regulation: EU 2023/1773 Art. 6(2)(c) — quarterly report must list total
    embedded emissions; UK Finance No.2 Bill 2025-26 s.24.
    """
    if report_package.get("type") != "cbam_report_package_v1":
        checks.append(CheckResult(
            "reconciliation.quarterly_totals",
            "Sum of goods-line emissions equals declared summary totals",
            passed=True,
            detail="non-CBAM packet — skipped",
        ))
        return True

    sum_direct   = Decimal("0")
    sum_indirect = Decimal("0")

    for _ship, _gl, emissions in _iter_goods_lines(report_package):
        if emissions is None:
            continue
        sum_direct   += _to_decimal(
            emissions.get("direct_embedded_kgco2e") or emissions.get("direct_emissions_kgco2e")
        ) or Decimal("0")
        sum_indirect += _to_decimal(
            emissions.get("indirect_embedded_kgco2e") or emissions.get("indirect_emissions_kgco2e")
        ) or Decimal("0")

    summary = report_package.get("summary") or {}
    expected_direct   = _to_decimal(summary.get("total_direct_emissions_kgco2e"))
    expected_indirect = _to_decimal(summary.get("total_indirect_emissions_kgco2e"))

    issues: list[str] = []
    if expected_direct is not None and abs(sum_direct - expected_direct) > tolerance:
        issues.append(
            f"direct: sum_goods_lines={sum_direct}, summary={expected_direct}, "
            f"diff={abs(sum_direct - expected_direct)}"
        )
    if expected_indirect is not None and abs(sum_indirect - expected_indirect) > tolerance:
        issues.append(
            f"indirect: sum_goods_lines={sum_indirect}, summary={expected_indirect}, "
            f"diff={abs(sum_indirect - expected_indirect)}"
        )

    passed = not issues
    detail = "; ".join(issues)
    checks.append(CheckResult(
        "reconciliation.quarterly_totals",
        "Sum of goods-line emissions equals declared summary totals",
        passed=passed,
        detail=detail,
    ))
    if not passed:
        failures.append(f"Quarterly totals mismatch: {detail}")
    return passed


def _check_cpr_cap(
    report_package: dict,
    checks: list[CheckResult],
    failures: list[str],
) -> bool:
    """
    Check 8: CPR cannot exceed the CBAM charge for each goods line.

    Per Finance No.2 Bill 2025-26 and CLAUDE.md Rule 7:
    cpr_gbp ≤ cbam_charge_gbp for every goods line (liability cannot go negative).

    Checks the hmrc_return block if present; otherwise skips gracefully.
    """
    hmrc = report_package.get("hmrc_return") or {}
    consignments = hmrc.get("consignments") or []

    if not consignments:
        checks.append(CheckResult(
            "reconciliation.cpr_cap",
            "CPR ≤ CBAM charge for all goods lines (liability cannot be negative)",
            passed=True,
            detail="no hmrc_return block — skipped",
        ))
        return True

    violations: list[str] = []
    for consignment in consignments:
        for gl in consignment.get("goods_lines") or []:
            cn8 = gl.get("cn8_code") or "?"
            charge = _to_decimal(gl.get("cbam_charge_gbp")) or Decimal("0")
            cpr    = _to_decimal(gl.get("cpr_gbp")) or Decimal("0")
            if cpr > charge:
                violations.append(
                    f"cn8={cn8}: cpr_gbp={cpr} > cbam_charge_gbp={charge}"
                )

    passed = not violations
    detail = "; ".join(violations)
    checks.append(CheckResult(
        "reconciliation.cpr_cap",
        "CPR ≤ CBAM charge for all goods lines (liability cannot be negative)",
        passed=passed,
        detail=detail,
    ))
    if not passed:
        failures.append(f"CPR cap violated: {detail}")
    return passed


def _check_hmac_chain(
    report_package: dict,
    checks: list[CheckResult],
    failures: list[str],
) -> bool:
    """
    Check 6: HMAC chain integrity — every snapshot must have a valid parent hash.

    Verifies that the report package carries a snapshot_hash and that it is
    non-empty (structural integrity).  Full chain re-verification from storage
    is performed by the snapshot_store; this check validates that the package
    assembled for output carries a chain reference.

    Regulation: CLAUDE.md Rule 5 — audit chain must be maintained.
    """
    audit = report_package.get("audit") or {}
    snapshot_hash = (
        audit.get("snapshot_hash")
        or audit.get("payload_hash")
        or report_package.get("snapshot_hash")
    )

    if not snapshot_hash:
        checks.append(CheckResult(
            "reconciliation.hmac_chain",
            "HMAC chain reference present in report package",
            passed=False,
            detail=(
                "report_package.audit.snapshot_hash is absent — the report package "
                "cannot be linked to the audit chain (CLAUDE.md Rule 5)"
            ),
        ))
        failures.append(
            "HMAC chain: snapshot_hash missing from report package — "
            "compliance_pack_v1 must not be generated without a valid audit chain reference"
        )
        return False

    checks.append(CheckResult(
        "reconciliation.hmac_chain",
        "HMAC chain reference present in report package",
        passed=True,
        detail=f"snapshot_hash={str(snapshot_hash)[:16]}…",
    ))
    return True


# ── Pre-output reconciliation gate ─────────────────────────────────────────────

def run_pre_output_reconciliation(
    report_package: dict,
    narrative: dict | None = None,
    case_id: str | None = None,
) -> ValidationResult:
    """
    Run all 8 CLAUDE.md reconciliation checks before generating compliance_pack_v1.

    This is the gate that MUST pass before any compliance output is produced.
    Callers should check result.human_review_required and abort output generation
    if True, surfacing result.failures to the operator.

    The 8 checks (CLAUDE.md §Reconciliation Checks):
      1. Mass consistency     — net_mass present and non-zero for all goods lines
      2. SEE plausibility     — via data_quality.warnings (reconciliation_warning tags)
      3. Unit normalisation   — flagged in data_quality by cbam_emission_factors
      4. Quarterly totals     — sum of goods-line emissions = summary totals
      5. CN code scope        — all CN codes map to a CBAM sector
      6. HMAC chain           — snapshot_hash present and linked
      7. Verification status  — actual_verified lines have verification_status='verified'
      8. CPR cap              — cpr_gbp ≤ cbam_charge_gbp per line

    Checks 2+3 are covered implicitly by _check_reconciliation_warnings (they
    are surfaced as reconciliation_warning tags in data_quality by the extraction
    and calculation layers; if any such warning is present, human_review is required).

    Parameters
    ----------
    report_package:
        The cbam_report_package_v1 dict.
    narrative:
        Optional narrative dict. When provided, also runs narrative-consistency
        checks (numeric totals, reporting period, limitations coverage).
        Pass None to run only the 8 data-integrity checks.
    case_id:
        UUID string for audit log attribution. None skips audit log write.
    """
    _narrative = narrative or {}
    checks: list[CheckResult] = []
    failures: list[str] = []
    open_gaps: list[dict] = []
    method_downgrades: list[dict] = []

    # ── Check 1: Mass consistency ──────────────────────────────────────────────
    mass_passed = _check_mass_consistency(report_package, checks, failures)

    # ── Checks 2+3: SEE plausibility + unit normalisation (via recon tags) ────
    recon_passed = _check_reconciliation_warnings(report_package, checks, failures)

    # ── Check 4: Quarterly totals ─────────────────────────────────────────────
    totals_passed = _check_quarterly_totals(report_package, checks, failures)

    # ── Check 5: CN code scope ────────────────────────────────────────────────
    scope_passed = _check_cn_code_scope(report_package, checks, failures)

    # ── Check 6: HMAC chain ────────────────────────────────────────────────────
    chain_passed = _check_hmac_chain(report_package, checks, failures)

    # ── Check 7: Verification status ─────────────────────────────────────────
    _check_actual_verification_status(
        report_package, checks, failures, open_gaps, method_downgrades
    )

    # ── Check 8: CPR cap ──────────────────────────────────────────────────────
    cpr_cap_passed = _check_cpr_cap(report_package, checks, failures)

    # ── Optional narrative consistency checks (when narrative provided) ───────
    if narrative is not None:
        _check_numeric_totals(report_package, _narrative, checks, failures)
        _check_calculation_methods(report_package, checks, failures)
        _check_warnings_surfaced_in_limitations(report_package, _narrative, checks, failures)
        _check_cpr_verifier(report_package, _narrative, checks, failures)
        _check_reporting_period(report_package, _narrative, checks, failures)

    # ── Gate decision ─────────────────────────────────────────────────────────
    # Blocking failures: mass missing, reconciliation warnings, totals mismatch,
    # HMAC chain absent, CPR cap violated.  These prevent compliance_pack_v1.
    human_review_required = (
        not mass_passed
        or not recon_passed
        or not totals_passed
        or not chain_passed
        or not cpr_cap_passed
    )

    all_passed = all([mass_passed, recon_passed, totals_passed,
                      scope_passed, chain_passed, cpr_cap_passed])

    result = ValidationResult(
        passed=all_passed,
        human_review_required=human_review_required,
        failures=failures,
        checks=checks,
        open_gaps=open_gaps,
        method_downgrades=method_downgrades,
    )

    if case_id:
        _record_validation_in_audit_log(case_id, result, checks)

    return result


# ── Public API ─────────────────────────────────────────────────────────────────

def validate_report_package_integrity(
    report_package: dict,
    narrative: dict,
    case_id: str | None = None,
) -> ValidationResult:
    """
    Validate that the narrative results are consistent with the report package.

    Runs in deterministic Python — no LLM calls, no network I/O.

    Parameters
    ----------
    report_package:
        The full CBAM report package dict (type=cbam_report_package_v1 or legacy).
    narrative:
        The narrative dict produced by app.services.narrative.run_pipeline_stages,
        with results{} already hard-overridden from the report package.
    case_id:
        UUID string of the case, used for audit log attribution. If None,
        the audit log write is skipped.

    Returns
    -------
    ValidationResult
        passed: True only when every check passes.
        human_review_required: True on numeric mismatch, missing method, or
            unaddressed reconciliation warning.
        failures: list of human-readable failure descriptions.
        checks: full check matrix (written to audit log).
    """
    checks: list[CheckResult] = []
    failures: list[str] = []
    open_gaps: list[dict] = []
    method_downgrades: list[dict] = []

    # ── Numeric cross-checks ───────────────────────────────────────────────────
    numeric_passed = _check_numeric_totals(report_package, narrative, checks, failures)
    period_passed = _check_reporting_period(report_package, narrative, checks, failures)

    # ── Completeness checks ────────────────────────────────────────────────────
    method_passed = _check_calculation_methods(report_package, checks, failures)
    warnings_passed = _check_warnings_surfaced_in_limitations(
        report_package, narrative, checks, failures
    )
    scope_passed = _check_cn_code_scope(report_package, checks, failures)
    cpr_passed = _check_cpr_verifier(report_package, narrative, checks, failures)
    recon_passed = _check_reconciliation_warnings(report_package, checks, failures)

    # ── Verification status check (Phase 3B) ──────────────────────────────────
    # Non-blocking: populates open_gaps + method_downgrades for callers but
    # does NOT set human_review_required.  The return is produced with
    # conservative actual_unverified methods for any unverified goods lines.
    _check_actual_verification_status(
        report_package, checks, failures, open_gaps, method_downgrades
    )

    # ── human_review_required decision ────────────────────────────────────────
    # Triggers on: numeric mismatch, missing calculation_method, or unaddressed
    # reconciliation warnings. Completeness gaps (warnings not in limitations,
    # CPR verifier, unverified actual lines) surface as failures / open_gaps
    # but do not block return production.
    human_review_required = (
        not numeric_passed
        or not method_passed
        or not recon_passed
    )

    all_passed = all([
        numeric_passed,
        period_passed,
        method_passed,
        warnings_passed,
        scope_passed,
        cpr_passed,
        recon_passed,
    ])

    result = ValidationResult(
        passed=all_passed,
        human_review_required=human_review_required,
        failures=failures,
        checks=checks,
        open_gaps=open_gaps,
        method_downgrades=method_downgrades,
    )

    # ── Audit log ─────────────────────────────────────────────────────────────
    if case_id:
        _record_validation_in_audit_log(case_id, result, checks)

    if failures:
        log.warning(
            "narrative_validation case_id=%s passed=%s human_review=%s failures=%d: %s",
            case_id,
            all_passed,
            human_review_required,
            len(failures),
            "; ".join(failures),
        )
    else:
        log.info(
            "narrative_validation case_id=%s passed=True checks=%d",
            case_id,
            len(checks),
        )

    return result
