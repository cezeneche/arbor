"""
CBAM Calculation Service — SEE formula and liability calculation.

This module is Layer 2 (calculation): pure functions only. No database reads,
no network calls, no side effects. Given identical inputs they return identical
outputs. Persistence of emission records belongs in the repository/router layer.

Implements:
  - compute_see()             Specific Embedded Emissions per tonne (EU 2023/1773 Art. 3)
  - compute_cbam_liability()  CBAM certificate count and financial exposure
                              (EU 2023/956 Arts. 9 and 21)

Regulation references
---------------------
EU Regulation 2023/956 (CBAM framework):
  - Article 9  — Deduction for carbon price already paid in origin country
  - Article 21 — Number of CBAM certificates to be surrendered
  - Article 22(5) — Certificates rounded up to the nearest whole number

Commission Implementing Regulation 2023/1773 (methodology):
  - Article 3 — Specific Embedded Emissions (SEE) calculation methodology
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Mapping

_D = Decimal
_ZERO = _D("0")
_THOUSAND = _D("1000")


@dataclass(frozen=True)
class GoodsLineSEE:
    """SEE breakdown and embedded-emission contribution for one goods line.

    All emission values in kgCO2e; SEE values in tCO2e/t.
    embedded_tco2e = see_total_tco2e_per_t × net_mass_t
    """
    goods_line_id: str
    cn_code: str
    net_mass_kg: Decimal
    net_mass_t: Decimal
    direct_kgco2e: Decimal
    indirect_kgco2e: Decimal
    total_kgco2e: Decimal
    see_direct_tco2e_per_t: Decimal
    see_indirect_tco2e_per_t: Decimal
    see_total_tco2e_per_t: Decimal
    embedded_tco2e: Decimal


@dataclass
class CBAMLiabilityResult:
    """Full CBAM liability output for a reporting case.

    Financial values are in EUR; emission values in tCO2e or kgCO2e as labelled.
    """
    # Inputs echoed for audit trail
    eu_ets_price_eur: Decimal
    carbon_price_paid_eur: Decimal

    # Per-line SEE breakdown
    goods_lines: list[GoodsLineSEE]

    # Aggregates
    total_net_mass_t: Decimal
    total_direct_kgco2e: Decimal
    total_indirect_kgco2e: Decimal
    total_embedded_tco2e: Decimal          # gross, before deduction

    # Carbon price deduction (EU 2023/956 Art. 9)
    # deduction_tco2e = (carbon_price_paid / eu_ets_price) × total_embedded_tco2e
    carbon_price_deduction_tco2e: Decimal
    net_liability_tco2e: Decimal           # max(0, total_embedded − deduction)

    # Financial exposure
    gross_financial_liability_eur: Decimal  # total_embedded × eu_ets_price
    net_financial_liability_eur: Decimal    # net_liability × eu_ets_price

    # CBAM certificates: 1 certificate = 1 tCO2e, rounded up (Art. 22(5))
    cbam_certificates: int

    # Origin-country carbon pricing scheme (Art. 9 deduction context)
    origin_country: str | None = None
    carbon_pricing_scheme_name: str | None = None
    carbon_pricing_scheme_type: str | None = None

    regulation_refs: list[str] = field(default_factory=lambda: [
        "EU Regulation 2023/956, Article 9 (carbon price deduction)",
        "EU Regulation 2023/956, Article 21 (CBAM certificates to surrender)",
        "EU Regulation 2023/956, Article 22(5) (certificates rounded up)",
        "Commission Implementing Regulation 2023/1773, Article 3 (SEE methodology)",
    ])


def compute_see(
    direct_kgco2e: Decimal,
    indirect_kgco2e: Decimal,
    net_mass_kg: Decimal,
) -> tuple[Decimal, Decimal, Decimal]:
    """Return Specific Embedded Emissions (tCO2e per tonne) for a goods line.

    Formula per EU 2023/1773 Article 3:
        SEE_direct   = direct_kgco2e   / net_mass_t
        SEE_indirect = indirect_kgco2e / net_mass_t
        SEE_total    = SEE_direct + SEE_indirect

    where net_mass_t = net_mass_kg / 1000.

    Returns
    -------
    (see_direct_tco2e_per_t, see_indirect_tco2e_per_t, see_total_tco2e_per_t)

    Raises
    ------
    ValueError if net_mass_kg is not strictly positive.
    """
    mass_kg = _D(str(net_mass_kg))
    if mass_kg <= _ZERO:
        raise ValueError(f"net_mass_kg must be positive, got {net_mass_kg}")

    # SEE (tCO2e/t) = emission_kgco2e / mass_kg
    # kgCO2e / kg == tCO2e / t  (consistent unit ratios, no factor needed)
    # EU 2023/1773 Art. 3: SEE = Σ(direct + indirect) / net_mass_tonne,
    # where emissions are in tCO2e and mass in tonnes; expressing in kg/kg is equivalent.
    see_direct = (_D(str(direct_kgco2e)) / mass_kg).quantize(_D("0.000001"))
    see_indirect = (_D(str(indirect_kgco2e)) / mass_kg).quantize(_D("0.000001"))
    return see_direct, see_indirect, (see_direct + see_indirect)


def compute_cbam_liability(
    goods_lines: list[Mapping[str, Any]],
    eu_ets_price_eur: Decimal,
    carbon_price_paid_eur: Decimal = _ZERO,
    origin_country: str | None = None,
    carbon_pricing_scheme_name: str | None = None,
    carbon_pricing_scheme_type: str | None = None,
) -> CBAMLiabilityResult:
    """Compute CBAM liability for a reporting case.

    Parameters
    ----------
    goods_lines:
        Each mapping must contain:
          - goods_line_id   str / UUID
          - cn_code         str
          - net_mass_kg     numeric (kg)
          - direct_kgco2e   numeric
          - indirect_kgco2e numeric (may be None → treated as 0)
    eu_ets_price_eur:
        EU ETS allowance price for the reporting period (EUR per tCO2e).
        Must be > 0.
    carbon_price_paid_eur:
        Effective carbon price already paid in the origin country (EUR/tCO2e).
        0 when the origin country has no recognised equivalent carbon pricing
        scheme (EU 2023/956 Art. 9).  Must be >= 0.

    Returns
    -------
    CBAMLiabilityResult

    Notes
    -----
    Liability formula (EU 2023/956 Art. 21):
        total_embedded_tco2e = Σ (SEE_i × mass_t_i)
        deduction_tco2e      = (carbon_price_paid / eu_ets_price) × total_embedded
        net_liability_tco2e  = max(0, total_embedded − deduction)
        cbam_certificates    = ⌈ net_liability_tco2e ⌉
        financial_liability  = net_liability_tco2e × eu_ets_price
    """
    eu_ets = _D(str(eu_ets_price_eur))
    cp_paid = _D(str(carbon_price_paid_eur))

    if eu_ets <= _ZERO:
        raise ValueError(f"eu_ets_price_eur must be > 0, got {eu_ets}")
    if cp_paid < _ZERO:
        raise ValueError(f"carbon_price_paid_eur must be >= 0, got {cp_paid}")

    line_results: list[GoodsLineSEE] = []
    total_embedded = _ZERO

    for gl in goods_lines:
        direct = _D(str(gl["direct_kgco2e"]))
        indirect = _D(str(gl.get("indirect_kgco2e") or 0))
        mass_kg = _D(str(gl["net_mass_kg"]))
        total_kgco2e = direct + indirect

        if mass_kg <= _ZERO:
            see_d = see_i = see_t = _ZERO
            embedded = _ZERO
            mass_t = _ZERO
        else:
            see_d, see_i, see_t = compute_see(direct, indirect, mass_kg)
            mass_t = (mass_kg / _THOUSAND).quantize(_D("0.000001"))
            embedded = (see_t * mass_t).quantize(_D("0.000001"))

        total_embedded += embedded
        line_results.append(GoodsLineSEE(
            goods_line_id=str(gl["goods_line_id"]),
            cn_code=str(gl["cn_code"]),
            net_mass_kg=mass_kg,
            net_mass_t=mass_t,
            direct_kgco2e=direct,
            indirect_kgco2e=indirect,
            total_kgco2e=total_kgco2e,
            see_direct_tco2e_per_t=see_d,
            see_indirect_tco2e_per_t=see_i,
            see_total_tco2e_per_t=see_t,
            embedded_tco2e=embedded,
        ))

    total_embedded = total_embedded.quantize(_D("0.000001"))

    # Carbon price deduction (EU 2023/956 Art. 9)
    if cp_paid > _ZERO:
        deduction_ratio = (cp_paid / eu_ets).quantize(_D("0.000001"))
        deduction = (deduction_ratio * total_embedded).quantize(_D("0.000001"))
    else:
        deduction = _ZERO

    net_liability = max(_ZERO, total_embedded - deduction).quantize(_D("0.000001"))

    # EU 2023/956 Art. 21 — financial exposure = chargeable emissions × ETS price
    gross_financial = (total_embedded * eu_ets).quantize(_D("0.01"))
    net_financial = (net_liability * eu_ets).quantize(_D("0.01"))
    # EU 2023/956 Art. 22(5) — one certificate per tCO2e, rounded up to a whole number
    certificates = math.ceil(float(net_liability))

    total_direct = sum((gl.direct_kgco2e for gl in line_results), _ZERO).quantize(_D("0.001"))
    total_indirect = sum((gl.indirect_kgco2e for gl in line_results), _ZERO).quantize(_D("0.001"))
    total_mass_t = sum((gl.net_mass_t for gl in line_results), _ZERO).quantize(_D("0.000001"))

    return CBAMLiabilityResult(
        eu_ets_price_eur=eu_ets,
        carbon_price_paid_eur=cp_paid,
        goods_lines=line_results,
        total_net_mass_t=total_mass_t,
        total_direct_kgco2e=total_direct,
        total_indirect_kgco2e=total_indirect,
        total_embedded_tco2e=total_embedded,
        carbon_price_deduction_tco2e=deduction,
        net_liability_tco2e=net_liability,
        gross_financial_liability_eur=gross_financial,
        net_financial_liability_eur=net_financial,
        cbam_certificates=certificates,
        origin_country=origin_country,
        carbon_pricing_scheme_name=carbon_pricing_scheme_name,
        carbon_pricing_scheme_type=carbon_pricing_scheme_type,
    )
