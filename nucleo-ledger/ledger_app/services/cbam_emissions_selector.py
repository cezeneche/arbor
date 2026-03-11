"""CBAM Emissions Method Selector — deterministic actual vs. default decision engine.

This module implements the core regulatory decision rule for choosing between
supplier-declared actual emissions and EU 2023/1773 Annex VI default values.

Decision sequence (EU 2023/1773 Art. 4)
----------------------------------------
1. **Actual method** — use if supplier-declared emissions are present, exceed
   the minimum quality threshold, and are expressed in a recognised unit.
2. **Estimated method** — use if partial emissions data exists (e.g. only direct,
   no indirect) that passes a lower quality bar.  The missing component is
   filled from Annex VI defaults.
3. **Default method** — use when no usable supplier data is present.  All values
   are taken from the Annex VI factor table keyed on CN code.

Every decision is recorded in a ``MethodSelectionResult`` that carries:
  - the chosen method
  - the computed direct/indirect kgCO2e values
  - the SEE (tCO2e/t) values
  - a structured decision trace for the evidence ledger
  - all intermediate warnings

Entry point
-----------
``select_and_calculate(goods_line_data) → MethodSelectionResult``

Callers
-------
- ``drafts.py``  — called at the end of the upload-and-extract pipeline
  so every goods line gets an emission record automatically created without
  the API consumer having to supply method or values manually.
- Any service needing to (re-)compute emissions for a goods line from scratch.

Regulation references
---------------------
EU Regulation 2023/956, Article 7 — embedded emissions
Commission Implementing Regulation 2023/1773:
  - Article 4(1) — actual embedded emissions (preferred)
  - Article 4(2) — estimated embedded emissions (partial data)
  - Article 4(3) — default values (fallback)
  - Annex VI     — default SEE table
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from ledger_app.services.cbam_emission_factors import (
    FACTOR_METADATA,
    get_default_see,
)
from ledger_app.services.cbam_calculation_service import compute_see

_D = Decimal
_ZERO = _D("0")

# ── Quality thresholds ────────────────────────────────────────────────────────

# Minimum confidence score for an extracted emission value to be accepted as
# "actual" quality.  Evidence atoms below this threshold are treated as absent.
ACTUAL_QUALITY_THRESHOLD: float = 0.60

# Maximum deviation from the Annex VI default that an "actual" value may show
# before a mandatory plausibility warning is appended.
# Expressed as a fraction (0.20 = 20%).  Does NOT block use of actual data —
# the warning is surfaced but the actual value is still used.
PLAUSIBILITY_DEVIATION_THRESHOLD: float = 0.20

# If an actual direct value deviates more than this multiple of the default,
# the value is flagged as a potential data error and the method is downgraded
# to "estimated" unless the caller explicitly overrides.
PLAUSIBILITY_EXTREME_MULTIPLE: float = 10.0

# Methods
METHOD_ACTUAL = "actual"
METHOD_ESTIMATED = "estimated"
METHOD_DEFAULT = "default"


# ── Evidence trace types ──────────────────────────────────────────────────────

@dataclass
class SelectionEvidenceAtom:
    """One step in the method-selection decision trace."""
    step: str           # e.g. "check_supplier_direct", "annex_vi_lookup"
    outcome: str        # e.g. "found", "absent", "below_threshold", "accepted"
    detail: str         # Human-readable explanation
    value: Any = None   # Optional numeric value associated with this step
    regulation_ref: str = ""


@dataclass
class MethodSelectionResult:
    """Full output of the automated emissions method selection.

    Attributes
    ----------
    method : str
        The chosen calculation method: ``"actual"`` | ``"estimated"`` | ``"default"``.
    direct_kgco2e : Decimal
        Direct embedded emissions in kgCO2e for this goods line.
    indirect_kgco2e : Decimal
        Indirect embedded emissions in kgCO2e.
    see_direct_tco2e_per_t : Decimal
        Direct SEE (tCO2e per tonne of goods).
    see_indirect_tco2e_per_t : Decimal
        Indirect SEE (tCO2e per tonne of goods).
    see_total_tco2e_per_t : Decimal
        Total SEE (direct + indirect).
    embedded_tco2e : Decimal
        Total embedded emissions for the shipment quantity (tCO2e).
    cn_code : str
        The CN code used for factor lookup.
    net_mass_kg : Decimal
        Net mass of the goods line (kg).
    production_route : str | None
        Production route used (if any).
    decision_trace : list[SelectionEvidenceAtom]
        Ordered list of decision steps — inserted into the evidence ledger.
    warnings : list[str]
        Non-blocking advisory messages (deviation from defaults, etc.).
    annex_vi_factor_used : bool
        True if any Annex VI default value was used (for mandatory disclosure).
    factor_metadata : dict
        Provenance of the Annex VI table used (regulation ref, version, etc.).
    regulation_refs : list[str]
        Regulatory citations for this calculation.
    """
    method: str
    direct_kgco2e: Decimal
    indirect_kgco2e: Decimal
    see_direct_tco2e_per_t: Decimal
    see_indirect_tco2e_per_t: Decimal
    see_total_tco2e_per_t: Decimal
    embedded_tco2e: Decimal
    cn_code: str
    net_mass_kg: Decimal
    production_route: str | None
    decision_trace: list[SelectionEvidenceAtom] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    annex_vi_factor_used: bool = False
    factor_metadata: dict = field(default_factory=lambda: dict(FACTOR_METADATA))
    regulation_refs: list[str] = field(default_factory=lambda: [
        "Commission Implementing Regulation 2023/1773, Article 4(1) — actual embedded emissions",
        "Commission Implementing Regulation 2023/1773, Article 4(2) — estimated embedded emissions",
        "Commission Implementing Regulation 2023/1773, Article 4(3) — default values",
        "Commission Implementing Regulation 2023/1773, Annex VI — default SEE table",
    ])


# ── Internal helpers ──────────────────────────────────────────────────────────

def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        d = _D(str(value))
        return d if d > _ZERO else None
    except (InvalidOperation, TypeError):
        return None


def _confidence(evidence: list[dict], field_name: str) -> float:
    """Return the highest confidence score for *field_name* in an evidence list."""
    scores = [
        float(atom.get("confidence", 0))
        for atom in (evidence or [])
        if isinstance(atom, dict) and atom.get("field", "").endswith(field_name)
    ]
    return max(scores) if scores else 0.0


def _plausibility_check(
    direct_kgco2e: Decimal,
    net_mass_kg: Decimal,
    cn_code: str,
    production_route: str | None,
) -> tuple[bool, bool, list[str]]:
    """Check if an actual direct value is plausible against the Annex VI default.

    Returns
    -------
    (within_normal_band, within_extreme_band, warnings)
      within_normal_band: True if deviation ≤ PLAUSIBILITY_DEVIATION_THRESHOLD
      within_extreme_band: True if actual ≤ PLAUSIBILITY_EXTREME_MULTIPLE × default
    """
    warnings: list[str] = []
    default_see = get_default_see(cn_code, production_route=None)
    if default_see is None:
        return True, True, warnings  # no reference to compare against

    default_direct_kg = default_see.direct_tco2e_per_t * net_mass_kg
    if default_direct_kg <= _ZERO:
        return True, True, warnings

    ratio = float(direct_kgco2e / default_direct_kg)
    deviation = abs(ratio - 1.0)

    within_normal = deviation <= PLAUSIBILITY_DEVIATION_THRESHOLD
    within_extreme = ratio <= PLAUSIBILITY_EXTREME_MULTIPLE

    if not within_normal:
        direction = "above" if ratio > 1.0 else "below"
        warnings.append(
            f"cbam_selector:plausibility_deviation:{cn_code} — "
            f"actual direct emissions are {deviation:.0%} {direction} the Annex VI "
            f"default (EU 2023/1773 Annex VI, {default_see.source_ref})"
        )
    if not within_extreme:
        warnings.append(
            f"cbam_selector:extreme_value:{cn_code} — "
            f"actual direct emissions are {ratio:.1f}× the Annex VI default; "
            f"recommend verifying source data before submission"
        )

    return within_normal, within_extreme, warnings


# ── Public API ────────────────────────────────────────────────────────────────

def select_and_calculate(
    *,
    cn_code: str,
    net_mass_kg: Decimal | float | Any,
    direct_kgco2e_supplier: Decimal | float | None = None,
    indirect_kgco2e_supplier: Decimal | float | None = None,
    supplier_direct_confidence: float = 0.0,
    supplier_indirect_confidence: float = 0.0,
    production_route: str | None = None,
    evidence: list[dict] | None = None,
    force_method: str | None = None,
) -> MethodSelectionResult:
    """Automatically select an emissions calculation method and compute SEE.

    Decision sequence (EU 2023/1773 Art. 4):

    1. If *force_method* is given, obey it without override logic.
    2. Check supplier-declared direct emissions:
       - Present AND confidence ≥ ACTUAL_QUALITY_THRESHOLD → candidate for "actual"
       - Present but confidence < threshold → candidate for "estimated" (gap-fill indirect)
       - Absent → fall through to default
    3. Plausibility check against Annex VI default:
       - If actual value is > 10× the default AND no confidence override → downgrade to "estimated"
       - Annex VI default is always used for indirect when indirect is absent
    4. If no usable supplier data → method = "default", all values from Annex VI.

    Parameters
    ----------
    cn_code:
        8-digit EU Combined Nomenclature code.
    net_mass_kg:
        Net mass of the goods line in kilograms.
    direct_kgco2e_supplier:
        Direct embedded emissions declared by the supplier (kgCO2e).
        None if absent from extraction.
    indirect_kgco2e_supplier:
        Indirect embedded emissions declared by the supplier (kgCO2e).
        None if absent.
    supplier_direct_confidence:
        Extraction confidence for the direct value (0.0–1.0).
        0.0 if absent or not extracted.
    supplier_indirect_confidence:
        Extraction confidence for the indirect value.
    production_route:
        Optional production route identifier (e.g. "BF_BOF", "EAF").
    evidence:
        Raw evidence atoms from the extractor.  Used to derive confidence
        when *supplier_direct_confidence* is 0.
    force_method:
        When set to "actual", "estimated", or "default", bypasses the
        automatic selection logic.  The supplied values are used as-is.
    """
    trace: list[SelectionEvidenceAtom] = []
    warnings: list[str] = []
    cn = str(cn_code or "").strip()
    mass_kg = _to_decimal(net_mass_kg) or _ZERO

    # ── Derive confidence from evidence atoms if not passed explicitly
    if evidence and supplier_direct_confidence == 0.0:
        supplier_direct_confidence = _confidence(evidence, "direct_embedded_kgco2e")
    if evidence and supplier_indirect_confidence == 0.0:
        supplier_indirect_confidence = _confidence(evidence, "indirect_embedded_kgco2e")

    direct_sup = _to_decimal(direct_kgco2e_supplier)
    indirect_sup = _to_decimal(indirect_kgco2e_supplier)

    # ── Handle force_method bypass
    if force_method in (METHOD_ACTUAL, METHOD_ESTIMATED, METHOD_DEFAULT):
        trace.append(SelectionEvidenceAtom(
            step="force_method",
            outcome="overridden",
            detail=f"Caller forced method={force_method!r}; skipping automatic selection.",
            regulation_ref="",
        ))
        method = force_method
        direct_kgco2e = direct_sup or _ZERO
        indirect_kgco2e = indirect_sup or _ZERO

        if method == METHOD_DEFAULT and mass_kg > _ZERO and cn:
            # Compute kgCO2e directly: SEE_tco2e_per_t × mass_kg = kgCO2e
            default_see = get_default_see(cn, production_route)
            if default_see is not None:
                direct_kgco2e = (default_see.direct_tco2e_per_t * mass_kg).quantize(_D("0.001"))
                indirect_kgco2e = (default_see.indirect_tco2e_per_t * mass_kg).quantize(_D("0.001"))
                warnings.append("annex_vi_factor_used:forced_default")

        return _build_result(
            method=method,
            direct_kgco2e=direct_kgco2e,
            indirect_kgco2e=indirect_kgco2e,
            mass_kg=mass_kg,
            cn_code=cn,
            production_route=production_route,
            trace=trace,
            warnings=warnings,
            annex_vi_used=(method == METHOD_DEFAULT),
        )

    # ── Step 1: check supplier direct emissions
    trace.append(SelectionEvidenceAtom(
        step="check_supplier_direct",
        outcome="found" if direct_sup is not None else "absent",
        detail=(
            f"Supplier direct emissions: {direct_sup} kgCO2e "
            f"(confidence={supplier_direct_confidence:.2f})"
            if direct_sup is not None
            else "No supplier direct emissions found in extraction output."
        ),
        value=float(direct_sup) if direct_sup is not None else None,
        regulation_ref="EU 2023/1773 Art. 4(1)",
    ))

    if direct_sup is None or supplier_direct_confidence < ACTUAL_QUALITY_THRESHOLD:
        # ── Path: Default (no usable supplier data)
        trace.append(SelectionEvidenceAtom(
            step="select_method",
            outcome="default",
            detail=(
                "No supplier direct emissions at required confidence. "
                "Falling back to Annex VI default values."
                if direct_sup is None
                else f"Supplier direct confidence {supplier_direct_confidence:.2f} < "
                     f"threshold {ACTUAL_QUALITY_THRESHOLD}. Using default method."
            ),
            regulation_ref="EU 2023/1773 Art. 4(3)",
        ))
        return _apply_default(cn, mass_kg, production_route, trace, warnings)

    # ── Step 2: plausibility check on actual value
    within_normal, within_extreme, plaus_warnings = _plausibility_check(
        direct_sup, mass_kg, cn, production_route
    )
    warnings.extend(plaus_warnings)

    trace.append(SelectionEvidenceAtom(
        step="plausibility_check",
        outcome="pass" if within_extreme else "extreme_value",
        detail=(
            "Actual direct value passed plausibility check against Annex VI default."
            if within_extreme
            else f"Actual direct value exceeds {PLAUSIBILITY_EXTREME_MULTIPLE}× "
                 f"the Annex VI default. Downgrading to 'estimated' method."
        ),
        value=float(direct_sup),
        regulation_ref="EU 2023/1773 Annex VI",
    ))

    if not within_extreme:
        # Downgrade: treat direct as unusable, use default
        trace.append(SelectionEvidenceAtom(
            step="select_method",
            outcome="default",
            detail="Extreme actual value detected; using Annex VI default for safety.",
            regulation_ref="EU 2023/1773 Art. 4(3)",
        ))
        return _apply_default(cn, mass_kg, production_route, trace, warnings)

    # ── Step 3: check supplier indirect emissions
    trace.append(SelectionEvidenceAtom(
        step="check_supplier_indirect",
        outcome="found" if indirect_sup is not None else "absent",
        detail=(
            f"Supplier indirect emissions: {indirect_sup} kgCO2e "
            f"(confidence={supplier_indirect_confidence:.2f})"
            if indirect_sup is not None
            else "No supplier indirect emissions. Will use 0 or Annex VI indirect default."
        ),
        value=float(indirect_sup) if indirect_sup is not None else None,
        regulation_ref="EU 2023/1773 Art. 4(1)",
    ))

    # ── Step 4: determine method and indirect value
    if (
        indirect_sup is not None
        and supplier_indirect_confidence >= ACTUAL_QUALITY_THRESHOLD
    ):
        method = METHOD_ACTUAL
        indirect_kgco2e = indirect_sup
        trace.append(SelectionEvidenceAtom(
            step="select_method",
            outcome="actual",
            detail="Both direct and indirect supplier values accepted. Method = actual.",
            regulation_ref="EU 2023/1773 Art. 4(1)",
        ))
    else:
        # Gap-fill indirect from Annex VI default
        method = METHOD_ESTIMATED
        annex_indirect = _ZERO
        default_see = get_default_see(cn, production_route=None)
        if default_see is not None and mass_kg > _ZERO:
            annex_indirect = (default_see.indirect_tco2e_per_t * mass_kg).quantize(_D("0.001"))
        indirect_kgco2e = annex_indirect
        trace.append(SelectionEvidenceAtom(
            step="select_method",
            outcome="estimated",
            detail=(
                "Direct emissions from supplier accepted; indirect gap-filled from "
                f"Annex VI default ({float(annex_indirect):.3f} kgCO2e). Method = estimated."
            ),
            value=float(annex_indirect),
            regulation_ref="EU 2023/1773 Art. 4(2) + Annex VI",
        ))
        warnings.append(
            f"cbam_selector:indirect_gap_filled:{cn} — "
            f"indirect emissions gap-filled from Annex VI default "
            f"({float(annex_indirect):.3f} kgCO2e); "
            f"method downgraded from actual to estimated "
            f"(EU 2023/1773 Art. 4(2))"
        )

    return _build_result(
        method=method,
        direct_kgco2e=direct_sup,
        indirect_kgco2e=indirect_kgco2e,
        mass_kg=mass_kg,
        cn_code=cn,
        production_route=production_route,
        trace=trace,
        warnings=warnings,
        annex_vi_used=(method == METHOD_ESTIMATED),
    )


def _apply_default(
    cn: str,
    mass_kg: Decimal,
    production_route: str | None,
    trace: list[SelectionEvidenceAtom],
    warnings: list[str],
) -> MethodSelectionResult:
    """Compute emission values from Annex VI defaults.

    kgCO2e = SEE_tco2e_per_t × mass_kg
    (numerically correct: tCO2e/t × kg = kgCO2e, since 1 tCO2e/t = 1 kgCO2e/kg)
    """
    direct_kgco2e = _ZERO
    indirect_kgco2e = _ZERO
    annex_vi_used = False

    if mass_kg > _ZERO and cn:
        default_see = get_default_see(cn, production_route=None)
        if default_see is not None:
            # SEE_tco2e_per_t × mass_kg gives kgCO2e (unit ratio: tCO2e/t = kgCO2e/kg)
            direct_kgco2e = (default_see.direct_tco2e_per_t * mass_kg).quantize(_D("0.001"))
            indirect_kgco2e = (default_see.indirect_tco2e_per_t * mass_kg).quantize(_D("0.001"))
            annex_vi_used = True
            trace.append(SelectionEvidenceAtom(
                step="annex_vi_lookup",
                outcome="found",
                detail=(
                    f"Annex VI default applied: "
                    f"direct={float(direct_kgco2e):.3f} kgCO2e, "
                    f"indirect={float(indirect_kgco2e):.3f} kgCO2e "
                    f"(SEE={float(default_see.total_tco2e_per_t):.3f} "
                    f"tCO2e/t, source: {default_see.source_ref})"
                ),
                value={"direct_kgco2e": float(direct_kgco2e), "indirect_kgco2e": float(indirect_kgco2e)},
                regulation_ref="EU 2023/1773 Art. 4(3) + Annex VI",
            ))
        else:
            trace.append(SelectionEvidenceAtom(
                step="annex_vi_lookup",
                outcome="not_found",
                detail=f"No Annex VI default factor for CN code {cn!r}. Values set to 0.",
                regulation_ref="EU 2023/1773 Annex VI",
            ))
            warnings.append(
                f"cbam_selector:no_default_factor:{cn} — "
                f"no Annex VI default available; direct and indirect emissions set to 0. "
                f"Manual entry required (EU 2023/1773 Annex VI)"
            )

    return _build_result(
        method=METHOD_DEFAULT,
        direct_kgco2e=direct_kgco2e,
        indirect_kgco2e=indirect_kgco2e,
        mass_kg=mass_kg,
        cn_code=cn,
        production_route=production_route,
        trace=trace,
        warnings=warnings,
        annex_vi_used=annex_vi_used,
    )


def _build_result(
    *,
    method: str,
    direct_kgco2e: Decimal,
    indirect_kgco2e: Decimal,
    mass_kg: Decimal,
    cn_code: str,
    production_route: str | None,
    trace: list[SelectionEvidenceAtom],
    warnings: list[str],
    annex_vi_used: bool,
) -> MethodSelectionResult:
    """Compute SEE and embedded tCO2e then assemble the final result."""
    if mass_kg > _ZERO:
        see_d, see_i, see_t = compute_see(direct_kgco2e, indirect_kgco2e, mass_kg)
        mass_t = (mass_kg / _D("1000")).quantize(_D("0.000001"))
        embedded = (see_t * mass_t).quantize(_D("0.000001"))
    else:
        see_d = see_i = see_t = embedded = _ZERO

    return MethodSelectionResult(
        method=method,
        direct_kgco2e=direct_kgco2e,
        indirect_kgco2e=indirect_kgco2e,
        see_direct_tco2e_per_t=see_d,
        see_indirect_tco2e_per_t=see_i,
        see_total_tco2e_per_t=see_t,
        embedded_tco2e=embedded,
        cn_code=cn_code,
        net_mass_kg=mass_kg,
        production_route=production_route,
        decision_trace=trace,
        warnings=warnings,
        annex_vi_factor_used=annex_vi_used,
    )


# ── Convenience: run selector on a parsed goods line dict ─────────────────────

def select_for_goods_line(goods_line: dict[str, Any]) -> MethodSelectionResult:
    """Run the selector on a goods-line dict from the extraction pipeline.

    The dict shape matches the output of ``cbam_extractor.py``:
    {
        "cn_code": str,
        "net_mass_kg": float | Decimal | None,
        "direct_embedded_kgco2e": float | Decimal | None,
        "indirect_embedded_kgco2e": float | Decimal | None,
        "method": str | None,        # supplier-declared method (advisory)
        "evidence": [EvidenceAtom],  # used for confidence scoring
    }

    Returns
    -------
    MethodSelectionResult
    """
    cn_code = str(goods_line.get("cn_code") or "").strip()
    net_mass_kg = goods_line.get("net_mass_kg") or goods_line.get("quantity")
    direct = goods_line.get("direct_embedded_kgco2e")
    indirect = goods_line.get("indirect_embedded_kgco2e")
    evidence = goods_line.get("evidence") or []

    # Supplier-declared method (advisory only — we may override it)
    declared_method = str(goods_line.get("method") or "").lower()
    force = declared_method if declared_method in (METHOD_ACTUAL, METHOD_ESTIMATED, METHOD_DEFAULT) else None

    return select_and_calculate(
        cn_code=cn_code,
        net_mass_kg=net_mass_kg,
        direct_kgco2e_supplier=direct,
        indirect_kgco2e_supplier=indirect,
        evidence=evidence,
        force_method=force,
    )
