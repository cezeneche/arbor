"""Upgrade 3 — algebraic constraints + maximum-entropy completion (pure stdlib).

Two jobs, both grounded in the algebra a record must satisfy rather than a
published default:

  1. Reject the physically impossible. Negative quantities, emissions that don't
     balance against tonnage × intensity, or an emissions intensity outside the
     plausible range for the sector are surfaced immediately — the fraud/erratum
     signal the rule-based admissibility spec can't see.

  2. Complete what's missing with maximum entropy, not a factor. When the
     emissions balance (emissions = tonnes × intensity) determines a missing
     field, fill it exactly (a point mass — zero entropy). When a field is only
     *bounded* (e.g. intensity constrained to the sector's plausible range but
     otherwise unknown), the maximum-entropy choice under only that bound is the
     uniform distribution: report the midpoint and the interval's entropy in bits
     as honest uncertainty — never presented as measured data.

Dependency-free: the constraints here are linear, so completion is algebra and a
uniform's entropy is log2(width). A general MaxEnt solver (cvxpy) is the
escalation if non-linear sector constraints are ever needed.
"""
from __future__ import annotations

import math
from typing import Optional

# Plausible embedded-emissions intensity per tonne (tCO2e/t) by sector. A value
# outside its range is physically implausible for that commodity — a strong
# fraud/erratum signal. Deliberately wide so only genuine outliers trip it.
SECTOR_INTENSITY_RANGE: dict[str, tuple[float, float]] = {
    "steel": (0.5, 3.5),
    "aluminium": (1.5, 25.0),
    "cement": (0.4, 1.2),
    "fertiliser": (0.5, 8.0),
    "hydrogen": (0.0, 12.0),
}

# Fields that can never be negative.
_NON_NEGATIVE = (
    "quantity_tonnes",
    "embedded_emissions_tco2e",
    "embedded_emissions_per_tonne",
    "total_consumption_kwh",
    "shipment_weight",
    "declared_weight",
    "quantity",
    "quantity_produced",
)
_PERCENT = (
    "nitrogen_content_percent",
    "phosphorus_content_percent",
    "potassium_content_percent",
)

# Relative tolerance on the emissions balance before it is flagged.
_BALANCE_TOL = 0.05


def _num(fields: dict, key: str) -> Optional[float]:
    v = fields.get(key)
    return v if isinstance(v, (int, float)) else None


def check_record(fields: dict, sector: Optional[str] = None) -> list[dict]:
    """Constraint violations for one record's field values."""
    out: list[dict] = []

    for k in _NON_NEGATIVE:
        v = _num(fields, k)
        if v is not None and v < 0:
            out.append({"field": k, "type": "NON_NEGATIVITY", "severity": "CRITICAL",
                        "message": f"{k} cannot be negative"})

    for k in _PERCENT:
        v = _num(fields, k)
        if v is not None and (v < 0 or v > 100):
            out.append({"field": k, "type": "PERCENT_BOUND", "severity": "CRITICAL",
                        "message": f"{k} must be within 0–100"})

    t = _num(fields, "quantity_tonnes")
    e = _num(fields, "embedded_emissions_tco2e")
    i = _num(fields, "embedded_emissions_per_tonne")

    # Emissions must balance: total = tonnes × intensity.
    if t is not None and e is not None and i is not None and t > 0 and i >= 0:
        expected = t * i
        if expected > 0 and abs(e - expected) / expected > _BALANCE_TOL:
            out.append({"field": "embedded_emissions_tco2e", "type": "MASS_BALANCE", "severity": "WARNING",
                        "message": f"embedded_emissions_tco2e ({e:g}) does not match "
                                   f"quantity_tonnes × per_tonne ({expected:g})"})

    # Intensity must be plausible for the sector.
    if i is not None and sector in SECTOR_INTENSITY_RANGE:
        lo, hi = SECTOR_INTENSITY_RANGE[sector]
        if i < lo or i > hi:
            out.append({"field": "embedded_emissions_per_tonne", "type": "IMPLAUSIBLE_INTENSITY",
                        "severity": "CRITICAL",
                        "message": f"emissions intensity {i:g} is outside the plausible "
                                   f"{sector} range [{lo:g}, {hi:g}]"})

    return out


def complete_missing(fields: dict, sector: Optional[str] = None) -> list[dict]:
    """Maximum-entropy completions for missing fields.

    Determined-by-balance completions are exact (entropy 0); a field bounded only
    by the sector range is completed with the uniform (max-entropy) midpoint and
    the interval's entropy in bits.
    """
    out: list[dict] = []
    t = _num(fields, "quantity_tonnes")
    e = _num(fields, "embedded_emissions_tco2e")
    i = _num(fields, "embedded_emissions_per_tonne")
    known = sum(x is not None for x in (t, e, i))

    # Exactly one of the balance triple missing → determined by the other two.
    if known == 2:
        if e is None and t is not None and i is not None:
            out.append({"field": "embedded_emissions_tco2e", "value": t * i,
                        "method": "mass_balance", "determined": True, "entropy_bits": 0.0})
        elif t is None and e is not None and i is not None and i > 0:
            out.append({"field": "quantity_tonnes", "value": e / i,
                        "method": "mass_balance", "determined": True, "entropy_bits": 0.0})
        elif i is None and e is not None and t is not None and t > 0:
            out.append({"field": "embedded_emissions_per_tonne", "value": e / t,
                        "method": "mass_balance", "determined": True, "entropy_bits": 0.0})
    # Intensity unknown and undetermined but bounded by the sector → MaxEnt uniform.
    elif i is None and sector in SECTOR_INTENSITY_RANGE and (t is None or e is None):
        lo, hi = SECTOR_INTENSITY_RANGE[sector]
        if hi > lo:
            out.append({"field": "embedded_emissions_per_tonne", "value": (lo + hi) / 2.0,
                        "method": "maxent_uniform", "determined": False,
                        "entropy_bits": math.log2(hi - lo), "low": lo, "high": hi})

    return out
