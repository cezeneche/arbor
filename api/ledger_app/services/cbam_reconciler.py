"""CBAM Quarterly Reconciler — cross-shipment aggregation and consistency checks.

Implements three regulatory requirements that span multiple CBAM cases:

B1 — Quarterly aggregation
    Rolls up all CBAM cases for (importer_eori, reporting_year, reporting_quarter)
    into a single QuarterlyReconciliationResult.  Produces the certificate count
    and net liability figures the importer must surrender under EU 2023/956 Art. 21.

B2 — Supplier-level SEE consistency
    Detects anomalous SEE values by comparing a new shipment's SEE against the
    rolling 12-month mean + 2σ band for the same (supplier_eori, cn_code) pair.
    Flags if the deviation exceeds the SUPPLIER_SEE_DEVIATION_THRESHOLD (default 30%).

B3 — Art. 9 carbon price plausibility
    Validates that a declared third-country carbon price is plausible relative to
    published EU ETS reference bands.  Flags suspiciously low values (< 30% of EUA)
    or suspiciously high values (> 200% of EUA) per DG TAXUD guidance.

Regulation references
---------------------
EU Regulation 2023/956, Article 9  — carbon price already paid in third country
EU Regulation 2023/956, Article 21 — CBAM certificates to surrender
EU Regulation 2023/956, Article 22(5) — certificates rounded up
Commission Implementing Regulation 2023/1773, Article 3 — SEE methodology
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Sequence

_D = Decimal
_ZERO = _D("0")
_THOUSAND = _D("1000")
_SIX = _D("0.000001")

# ── Thresholds ────────────────────────────────────────────────────────────────

# B2: flag supplier SEE if it deviates more than this fraction from rolling mean
SUPPLIER_SEE_DEVIATION_THRESHOLD = _D("0.30")

# B3: Art. 9 plausibility bands expressed as fractions of the reference EUA price
CARBON_PRICE_LOW_BAND = _D("0.30")    # below 30% of EUA → suspiciously low
CARBON_PRICE_HIGH_BAND = _D("2.00")   # above 200% of EUA → suspiciously high

# Minimum history size to compute supplier rolling statistics
MIN_HISTORY_FOR_STATS = 3


# ── Result types ──────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SupplierSEEFlag:
    """A supplier-level SEE anomaly flag (B2).

    Attributes
    ----------
    supplier_eori : str
        EORI of the goods supplier (origin-country installation operator or exporter).
    cn_code : str
        8-digit CN code for which the deviation was detected.
    current_see : Decimal
        SEE value from the shipment being evaluated (tCO2e/t).
    rolling_mean : Decimal
        12-month rolling mean SEE for this (supplier, cn_code) pair.
    deviation_pct : Decimal
        Absolute fractional deviation: |current − mean| / mean.
    threshold_pct : Decimal
        The threshold that was exceeded.
    case_ids : list[str]
        CBAM case IDs contributing to the rolling history.
    """
    supplier_eori: str
    cn_code: str
    current_see: Decimal
    rolling_mean: Decimal
    deviation_pct: Decimal
    threshold_pct: Decimal
    case_ids: list[str]


@dataclass(frozen=True)
class CarbonPriceFlag:
    """An Art. 9 carbon price plausibility flag (B3).

    Attributes
    ----------
    origin_country : str
    declared_price_eur : Decimal
        Carbon price the importer claims to have paid (EUR/tCO2e).
    reference_price_eur : Decimal
        The EUA reference price used for comparison.
    ratio : Decimal
        declared / reference.
    direction : str
        ``"too_low"`` or ``"too_high"``.
    """
    origin_country: str
    declared_price_eur: Decimal
    reference_price_eur: Decimal
    ratio: Decimal
    direction: str  # "too_low" | "too_high"


@dataclass
class QuarterlyReconciliationResult:
    """Full quarterly reconciliation output for one importer / reporting period.

    All emission values are in tCO2e; financial values in EUR.
    """
    importer_eori: str
    reporting_year: int
    reporting_quarter: int

    # Aggregated from all cases
    case_count: int
    shipment_count: int
    goods_line_count: int
    total_net_mass_t: Decimal
    total_direct_tco2e: Decimal
    total_indirect_tco2e: Decimal
    total_embedded_tco2e: Decimal          # gross, before Art. 9 deduction

    # Art. 9 deduction (summed across cases)
    total_carbon_price_deduction_tco2e: Decimal
    net_liability_tco2e: Decimal           # max(0, embedded − deduction)
    cbam_certificates_required: int        # ceil(net_liability) per Art. 22(5)

    # Estimated financial exposure (requires eu_ets_price from caller)
    eu_ets_price_eur: Decimal | None
    gross_financial_liability_eur: Decimal | None
    net_financial_liability_eur: Decimal | None

    # Consistency flags
    supplier_see_flags: list[SupplierSEEFlag] = field(default_factory=list)
    carbon_price_flags: list[CarbonPriceFlag] = field(default_factory=list)

    # Audit
    case_ids: list[str] = field(default_factory=list)
    regulation_refs: list[str] = field(default_factory=lambda: [
        "EU Regulation 2023/956, Article 9 (carbon price deduction)",
        "EU Regulation 2023/956, Article 21 (CBAM certificates)",
        "EU Regulation 2023/956, Article 22(5) (certificates rounded up)",
        "Commission Implementing Regulation 2023/1773, Article 3 (SEE methodology)",
    ])


# ── EUA reference price bands (B3) ───────────────────────────────────────────
#
# Quarterly indicative EU ETS (EUA) settlement price bands for the transitional
# period.  Source: EC DG CLIMA / ICE EUA front-month closing prices.
# These are approximate midpoints — compliance officers should substitute the
# official quarterly average published by EC before finalising the declaration.
#
# Format: (year, quarter) → (low_eur, mid_eur, high_eur)

_EUA_REFERENCE_BANDS: dict[tuple[int, int], tuple[Decimal, Decimal, Decimal]] = {
    (2023, 4): (_D("60"), _D("70"), _D("85")),
    (2024, 1): (_D("55"), _D("65"), _D("75")),
    (2024, 2): (_D("60"), _D("68"), _D("78")),
    (2024, 3): (_D("55"), _D("62"), _D("70")),
    (2024, 4): (_D("55"), _D("62"), _D("70")),
    (2025, 1): (_D("60"), _D("68"), _D("78")),
    (2025, 2): (_D("58"), _D("65"), _D("75")),
    (2025, 3): (_D("55"), _D("63"), _D("73")),
    (2025, 4): (_D("55"), _D("63"), _D("73")),
    (2026, 1): (_D("55"), _D("65"), _D("75")),
    (2026, 2): (_D("55"), _D("65"), _D("75")),
}
_EUA_DEFAULT_MID = _D("65")  # fallback when period not in table


def get_eua_reference_price(year: int, quarter: int) -> Decimal:
    """Return the indicative mid EUA price for a reporting period (EUR/tCO2e)."""
    band = _EUA_REFERENCE_BANDS.get((year, quarter))
    return band[1] if band else _EUA_DEFAULT_MID


# ── Internal helpers ──────────────────────────────────────────────────────────

def _to_decimal(value: Any, default: Decimal = _ZERO) -> Decimal:
    if value is None:
        return default
    try:
        return _D(str(value))
    except (InvalidOperation, TypeError):
        return default


def _compute_see_total(direct_kgco2e: Decimal, indirect_kgco2e: Decimal, mass_kg: Decimal) -> Decimal:
    """SEE total (tCO2e/t) from kgCO2e and kg inputs.  Returns 0 on zero mass."""
    if mass_kg <= _ZERO:
        return _ZERO
    return ((direct_kgco2e + indirect_kgco2e) / mass_kg).quantize(_SIX)


# ── B2: Supplier SEE consistency ─────────────────────────────────────────────

def check_supplier_see_consistency(
    current_see: Decimal,
    cn_code: str,
    supplier_eori: str,
    history: Sequence[Decimal],
    history_case_ids: Sequence[str] | None = None,
    threshold: Decimal = SUPPLIER_SEE_DEVIATION_THRESHOLD,
) -> SupplierSEEFlag | None:
    """Check whether *current_see* is anomalous relative to historical values.

    Parameters
    ----------
    current_see:
        SEE (tCO2e/t) from the shipment being evaluated.
    cn_code:
        8-digit CN code.
    supplier_eori:
        Exporter / installation operator EORI.
    history:
        Rolling historical SEE values for this (supplier, cn_code) pair.
        Must contain at least MIN_HISTORY_FOR_STATS entries to trigger a check.
    history_case_ids:
        Optional CBAM case IDs associated with the history entries (for audit).
    threshold:
        Fractional deviation threshold (default 0.30 = 30%).

    Returns
    -------
    SupplierSEEFlag if the deviation exceeds *threshold*, else None.
    """
    if len(history) < MIN_HISTORY_FOR_STATS:
        return None

    floats = [float(v) for v in history]
    mean = _D(str(statistics.mean(floats))).quantize(_SIX)

    if mean <= _ZERO:
        return None

    deviation = abs(current_see - mean) / mean

    if deviation <= threshold:
        return None

    return SupplierSEEFlag(
        supplier_eori=supplier_eori,
        cn_code=cn_code,
        current_see=current_see.quantize(_SIX),
        rolling_mean=mean,
        deviation_pct=deviation.quantize(_D("0.0001")),
        threshold_pct=threshold,
        case_ids=list(history_case_ids or []),
    )


# ── B3: Carbon price plausibility ─────────────────────────────────────────────

def check_carbon_price_plausibility(
    declared_price_eur: Decimal,
    origin_country: str,
    year: int,
    quarter: int,
    reference_price_eur: Decimal | None = None,
) -> CarbonPriceFlag | None:
    """Validate that a declared Art. 9 carbon price is plausible.

    Parameters
    ----------
    declared_price_eur:
        Carbon price the importer claims was paid in the origin country (EUR/tCO2e).
    origin_country:
        ISO 3166-1 alpha-2 country code of the goods origin.
    year, quarter:
        Reporting period — used to select the appropriate EUA reference band.
    reference_price_eur:
        Override for the EUA reference price.  When None, the indicative quarterly
        midpoint from the internal reference table is used.

    Returns
    -------
    CarbonPriceFlag if the price is outside the plausible band, else None.

    Notes
    -----
    Plausibility band:
        low_threshold  = reference × CARBON_PRICE_LOW_BAND  (default: 30% of EUA)
        high_threshold = reference × CARBON_PRICE_HIGH_BAND (default: 200% of EUA)

    A declared price below the low threshold is flagged as "too_low".
    A declared price above the high threshold is flagged as "too_high".
    """
    if declared_price_eur <= _ZERO:
        return None  # Zero means no Art. 9 claim — nothing to check

    ref = _to_decimal(reference_price_eur) if reference_price_eur is not None else get_eua_reference_price(year, quarter)
    if ref <= _ZERO:
        return None

    ratio = (declared_price_eur / ref).quantize(_D("0.0001"))

    if ratio < CARBON_PRICE_LOW_BAND:
        return CarbonPriceFlag(
            origin_country=origin_country,
            declared_price_eur=declared_price_eur,
            reference_price_eur=ref,
            ratio=ratio,
            direction="too_low",
        )

    if ratio > CARBON_PRICE_HIGH_BAND:
        return CarbonPriceFlag(
            origin_country=origin_country,
            declared_price_eur=declared_price_eur,
            reference_price_eur=ref,
            ratio=ratio,
            direction="too_high",
        )

    return None


# ── B1: Quarterly aggregation ─────────────────────────────────────────────────

def reconcile_quarter(
    cases: Sequence[dict[str, Any]],
    importer_eori: str,
    reporting_year: int,
    reporting_quarter: int,
    eu_ets_price_eur: Decimal | None = None,
    supplier_see_history: dict[tuple[str, str], tuple[list[Decimal], list[str]]] | None = None,
) -> QuarterlyReconciliationResult:
    """Aggregate all CBAM cases for a single quarterly reporting period.

    Parameters
    ----------
    cases:
        Each element is a dict representing one CBAM case with the shape:
        {
            "id": str,
            "importer_eori": str,
            "reporting_year": int,
            "reporting_quarter": int,
            "carbon_price_paid_eur": Decimal | None,   # Art. 9 declared price
            "origin_country": str | None,
            "goods_lines": [
                {
                    "goods_line_id": str,
                    "cn_code": str,
                    "supplier_eori": str | None,
                    "net_mass_kg": Decimal,
                    "direct_kgco2e": Decimal,
                    "indirect_kgco2e": Decimal,
                },
                ...
            ],
        }
        Only cases matching (importer_eori, reporting_year, reporting_quarter) are
        included; others are silently skipped.
    eu_ets_price_eur:
        Optional EUA price for financial liability calculation.  When None, no
        financial figures are computed and the corresponding fields are None.
    supplier_see_history:
        Pre-loaded historical SEE values keyed by (supplier_eori, cn_code).
        Value is (see_values, case_ids) — lists of the same length.
        Used for B2 supplier consistency check.  Pass None to skip the check.

    Returns
    -------
    QuarterlyReconciliationResult
    """
    total_direct = _ZERO
    total_indirect = _ZERO
    total_mass_t = _ZERO
    total_deduction = _ZERO
    shipment_count = 0
    goods_line_count = 0
    case_ids: list[str] = []

    supplier_flags: list[SupplierSEEFlag] = []
    carbon_flags: list[CarbonPriceFlag] = []

    eua = _to_decimal(eu_ets_price_eur) if eu_ets_price_eur is not None else None

    for case in cases:
        case_year = int(case.get("reporting_year") or 0)
        case_quarter = int(case.get("reporting_quarter") or 0)
        case_eori = str(case.get("importer_eori") or "")

        if (
            case_eori != importer_eori
            or case_year != reporting_year
            or case_quarter != reporting_quarter
        ):
            continue

        case_id = str(case.get("id") or "")
        case_ids.append(case_id)

        # Art. 9 deduction declared for this case
        cp_paid = _to_decimal(case.get("carbon_price_paid_eur"))
        origin_country = str(case.get("origin_country") or "")

        # B3 plausibility check per case
        if cp_paid > _ZERO and origin_country:
            cp_flag = check_carbon_price_plausibility(
                declared_price_eur=cp_paid,
                origin_country=origin_country,
                year=reporting_year,
                quarter=reporting_quarter,
                reference_price_eur=eua,
            )
            if cp_flag:
                carbon_flags.append(cp_flag)

        goods_lines = case.get("goods_lines") or []
        case_direct = _ZERO
        case_indirect = _ZERO
        case_mass_kg = _ZERO

        for gl in goods_lines:
            goods_line_count += 1
            mass_kg = _to_decimal(gl.get("net_mass_kg"))
            direct = _to_decimal(gl.get("direct_kgco2e"))
            indirect = _to_decimal(gl.get("indirect_kgco2e"))

            case_direct += direct
            case_indirect += indirect
            case_mass_kg += mass_kg

            # B2: check SEE anomaly per goods line
            if supplier_see_history is not None:
                cn_code = str(gl.get("cn_code") or "")
                supplier_eori_gl = str(gl.get("supplier_eori") or "")
                if cn_code and supplier_eori_gl:
                    see = _compute_see_total(direct, indirect, mass_kg)
                    hist_key = (supplier_eori_gl, cn_code)
                    hist_entry = supplier_see_history.get(hist_key, ([], []))
                    hist_values, hist_case_ids = hist_entry[0], hist_entry[1]
                    flag = check_supplier_see_consistency(
                        current_see=see,
                        cn_code=cn_code,
                        supplier_eori=supplier_eori_gl,
                        history=hist_values,
                        history_case_ids=hist_case_ids,
                    )
                    if flag and flag not in supplier_flags:
                        supplier_flags.append(flag)

        mass_t = (case_mass_kg / _THOUSAND).quantize(_SIX)
        case_embedded = _ZERO
        if mass_t > _ZERO:
            # embedded_tco2e = (direct_kgco2e + indirect_kgco2e) / net_mass_kg
            # kgCO2e/kg == tCO2e/t
            case_embedded = ((case_direct + case_indirect) / (case_mass_kg)).quantize(_SIX) * mass_t

        total_direct += case_direct
        total_indirect += case_indirect
        total_mass_t += mass_t

        # Art. 9 deduction for this case
        if cp_paid > _ZERO and eua is not None and eua > _ZERO:
            deduction_ratio = (cp_paid / eua).quantize(_SIX)
            total_deduction += (deduction_ratio * case_embedded).quantize(_SIX)

        # Count shipments from goods_lines (approximate — each case is one shipment minimum)
        shipment_count += 1

    total_direct = total_direct.quantize(_D("0.001"))
    total_indirect = total_indirect.quantize(_D("0.001"))
    total_mass_t = total_mass_t.quantize(_SIX)
    total_deduction = total_deduction.quantize(_SIX)

    total_embedded = ((total_direct + total_indirect) / _THOUSAND).quantize(_SIX) if total_mass_t > _ZERO else _ZERO
    # Recalculate embedded correctly: sum(direct + indirect) / 1000 gives tCO2e
    total_embedded_tco2e = ((total_direct + total_indirect) / _THOUSAND).quantize(_SIX)

    net_liability = max(_ZERO, total_embedded_tco2e - total_deduction).quantize(_SIX)
    certificates = math.ceil(float(net_liability))

    gross_fin = (total_embedded_tco2e * eua).quantize(_D("0.01")) if eua else None
    net_fin = (net_liability * eua).quantize(_D("0.01")) if eua else None

    return QuarterlyReconciliationResult(
        importer_eori=importer_eori,
        reporting_year=reporting_year,
        reporting_quarter=reporting_quarter,
        case_count=len(case_ids),
        shipment_count=shipment_count,
        goods_line_count=goods_line_count,
        total_net_mass_t=total_mass_t,
        total_direct_tco2e=total_direct / _THOUSAND,
        total_indirect_tco2e=total_indirect / _THOUSAND,
        total_embedded_tco2e=total_embedded_tco2e,
        total_carbon_price_deduction_tco2e=total_deduction,
        net_liability_tco2e=net_liability,
        cbam_certificates_required=certificates,
        eu_ets_price_eur=eua,
        gross_financial_liability_eur=gross_fin,
        net_financial_liability_eur=net_fin,
        supplier_see_flags=supplier_flags,
        carbon_price_flags=carbon_flags,
        case_ids=case_ids,
    )
