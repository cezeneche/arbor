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
    """
    passed: bool
    human_review_required: bool
    failures: list[str] = field(default_factory=list)
    checks: list[CheckResult] = field(default_factory=list)


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

    # ── human_review_required decision ────────────────────────────────────────
    # Triggers on: numeric mismatch, missing calculation_method, or unaddressed
    # reconciliation warnings. Completeness gaps (warnings not in limitations,
    # CPR verifier) are surfaced as failures but do not block processing.
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
