"""Public CBAM scope checker and liability calculator — no authentication required.

This module provides free lead-generation API endpoints for the
/tools/cbam-checker page.  No JWT, no tenant, no DB required — all
calculations run from the in-memory Annex VI factor table.

Endpoints
---------
POST /api/public/cbam-scope-check
    Check whether a CN commodity code is in scope for UK/EU CBAM and whether
    the annual import value exceeds the £50,000 registration threshold.

POST /api/public/cbam-liability-estimate
    Estimate annual CBAM liability using Annex VI default emissions intensities
    or a caller-supplied actual SEE value.

GET  /api/public/cbam-cn-lookup?q={prefix}
    Autocomplete: returns CN codes whose prefix overlaps the query string.
    Results drawn from the in-memory Annex VI factor table — no DB required.

Rate limit: 30 requests per rolling 60-second window per client IP.

Regulatory basis
----------------
UK CBAM: Finance No.2 Bill 2025-26.  Registration threshold £50,000 rolling
12-month import value.  First return due 31 May 2028 (Year 1, annual filers).

EU CBAM: Regulation (EU) 2023/956.  Full application from 1 January 2026.
First annual declaration due 31 May 2027 (for calendar year 2026 imports).

Default SEE values: Commission Implementing Regulation (EU) 2023/1773 Annex VI,
DG TAXUD Art. 4(3) default values (Dec 2023) — world-average figures.

UK ETS carbon price: HMRC reference rate for Q1 2027 quarterly average.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, model_validator

# ── Regulatory constants ────────────────────────────────────────────────────────

_UK_THRESHOLD_GBP: Decimal = Decimal("50000.00")
_UK_APPROACHING_GBP: Decimal = Decimal("40000.00")

# UK ETS Q1 2027 quarterly-average allowance price (HMRC published reference rate).
# Update each quarter when HMRC publishes the new rate.
_UK_ETS_RATE: Decimal = Decimal("52.40")
_UK_ETS_RATE_SOURCE: str = "UK ETS Q1 2027 quarterly average (HMRC reference rate)"

# EU ETS 2026 annual average (European Energy Exchange spot, converted at HMRC
# CDRM EUR/GBP rate).  Update when EU ETS Authority publishes annual averages.
_EU_ETS_RATE: Decimal = Decimal("55.25")
_EU_ETS_RATE_SOURCE: str = (
    "EU ETS 2026 annual average (EEX spot, converted at HMRC CDRM EUR/GBP 0.850)"
)

# 10 % surcharge applied to CBAM liability when using default (non-verified) SEE.
# Reflects the UK CBAM policy that unverified defaults attract a loading factor.
_DEFAULT_MARKUP: Decimal = Decimal("0.10")

# Subscription pricing (lead-gen comparison table)
_PROFESSIONAL_TIER_GBP: Decimal = Decimal("2499.00")

# First return deadlines
_UK_FIRST_RETURN: date = date(2028, 5, 31)   # Year 1 annual (2027 imports)
_EU_FIRST_RETURN: date = date(2027, 5, 31)   # First annual (2026 imports)

# ── Rate limiting ───────────────────────────────────────────────────────────────

_RATE_WINDOW: int = 60    # seconds
_RATE_LIMIT: int = 30     # requests per window per IP
_ip_windows: dict[str, deque[float]] = defaultdict(deque)


def _check_rate(ip: str) -> None:
    now = time.monotonic()
    window = _ip_windows[ip]
    cutoff = now - _RATE_WINDOW
    while window and window[0] < cutoff:
        window.popleft()
    if len(window) >= _RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please wait a minute and try again.",
            headers={"Retry-After": str(_RATE_WINDOW)},
        )
    window.append(now)


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ── Sector-specific next-step templates ────────────────────────────────────────

_SECTOR_STEPS: dict[str, list[str]] = {
    "iron_steel": [
        "Begin collecting supplier emissions data — request mill certificates and process route disclosures",
        "Identify the installation operator for each CBAM goods line and their ISO 14064-3 reporting obligations",
        "Consider engaging a GACI-accredited verifier to certify actual emissions data and avoid the 10% default surcharge",
    ],
    "cement": [
        "Contact your cement supplier for plant-level clinker and calcination CO₂ emissions data",
        "Review CN chapter 25 / 68 classification with your freight forwarder to ensure all CBAM goods are captured",
        "Check whether your supplier holds an ISO 14064-3 verified emissions report from the 2026 production year",
    ],
    "aluminium": [
        "Determine whether your aluminium is primary (smelting) or secondary (scrap remelting) — default SEE values differ by ~70%",
        "Request smelter-level electricity grid mix documentation to accurately calculate indirect embedded emissions",
        "Review CN chapter 76 classification for extrusions, wire, plates, and fabricated products",
    ],
    "fertilisers": [
        "Request ammonia plant N₂O abatement factor and plant-level GHG emissions data from your fertiliser supplier",
        "Review the specific CN code for nitric acid (2808), ammonia (2814), urea (3102) or compound fertilisers (3105)",
        "Verify your supplier has submitted a CBAM declaration for the relevant production installation",
    ],
    "electricity": [
        "Obtain the grid-average tCO₂e/MWh emission factor for the country of origin — published by the EU Commission for EU CBAM",
        "Retain metered import quantity documentation (MWh) for each billing period for HMRC reporting",
    ],
    "hydrogen": [
        "Identify the hydrogen production route: SMR (natural gas), electrolysis, or coal gasification — default SEE varies 10-fold",
        "Request plant-level steam methane reforming or electrolysis energy consumption data from your hydrogen supplier",
        "Check whether the production installation uses carbon capture and storage (CCS) — this reduces the applicable SEE",
    ],
}

_STEP_REGISTER_UK = (
    "Register with HMRC via Government Gateway by 31 January 2028 — "
    "you will need your EORI number and UK VAT registration"
)
_STEP_REGISTER_EU = (
    "Purchase EU CBAM certificates via the EU CBAM Transitional Registry "
    "(cbam.climate.ec.europa.eu) — required from 1 January 2026"
)
_STEP_MONITOR = (
    "Monitor your rolling 12-month CBAM goods import value monthly — "
    "HMRC registration is required when you reach £50,000"
)
_STEP_CTA = (
    "Start a free trial to automate threshold monitoring, supplier data collection, "
    "and HMRC return preparation"
)


def _build_next_steps(
    sector: str,
    registration_required: bool,
    regime: str,
) -> list[str]:
    steps: list[str] = []
    if registration_required:
        if "UK" in regime:
            steps.append(_STEP_REGISTER_UK)
        if "EU" in regime:
            steps.append(_STEP_REGISTER_EU)
    else:
        steps.append(_STEP_MONITOR)

    steps.extend(_SECTOR_STEPS.get(sector, [])[:2])
    steps.append(_STEP_CTA)
    return steps[:5]


# ── Emission factor helpers ─────────────────────────────────────────────────────

def _load_factors():
    """Lazy import to avoid circular imports at module load time."""
    from ledger_app.services.cbam_emission_factors import (
        _ANNEX_VI,  # noqa: PLC2701 — internal but same repo
        get_default_see,
    )
    return _ANNEX_VI, get_default_see


def _cn_search(q_digits: str, limit: int = 10) -> list[dict]:
    """Return world-average DefaultSEE entries whose cn8_prefix overlaps q_digits."""
    annex_vi, _ = _load_factors()
    results: list[dict] = []
    seen: set[str] = set()
    for entry in annex_vi:
        if entry.production_route is not None:
            continue  # only world-average (official) defaults
        cn = entry.cn8_prefix
        if cn in seen:
            continue
        if cn.startswith(q_digits) or q_digits.startswith(cn):
            seen.add(cn)
            results.append({
                "cn8_code": cn,
                "sector": entry.sector,
                "description": entry.description,
                "default_see_tco2e_per_t": round(float(entry.total_tco2e_per_t), 4),
                "direct_tco2e_per_t": round(float(entry.direct_tco2e_per_t), 4),
                "indirect_tco2e_per_t": round(float(entry.indirect_tco2e_per_t), 4),
            })
            if len(results) >= limit:
                break
    # Sort: exact or longer match first
    results.sort(key=lambda r: (not r["cn8_code"].startswith(q_digits), r["cn8_code"]))
    return results


def _resolve_see(cn8_code: str) -> tuple[object, str] | tuple[None, None]:
    """Return (DefaultSEE entry, normalised cn8_prefix) or (None, None)."""
    _, get_default_see = _load_factors()
    entry = get_default_see(cn8_code)
    return (entry, entry.cn8_prefix) if entry else (None, None)


# ── Pydantic request models ─────────────────────────────────────────────────────

class ScopeCheckRequest(BaseModel):
    cn8_code: str = Field(..., description="CN8 commodity code (2–8 digits)")
    annual_import_value_gbp: Decimal = Field(..., ge=0)
    regime: Literal["UK", "EU", "BOTH"] = "UK"

    @model_validator(mode="after")
    def _clean(self) -> "ScopeCheckRequest":
        self.cn8_code = "".join(ch for ch in self.cn8_code if ch.isdigit())
        if len(self.cn8_code) < 2:
            raise ValueError("cn8_code must contain at least 2 digits")
        return self


class LiabilityRequest(BaseModel):
    cn8_code: str = Field(..., description="CN8 commodity code (2–8 digits)")
    annual_import_tonnes: Decimal = Field(..., gt=0)
    origin_country: str = Field(default="CN", max_length=3)
    emissions_method: Literal["default", "actual"] = "default"
    actual_see_tco2e_per_t: Decimal | None = None
    regime: Literal["UK", "EU", "BOTH"] = "UK"

    @model_validator(mode="after")
    def _validate(self) -> "LiabilityRequest":
        self.cn8_code = "".join(ch for ch in self.cn8_code if ch.isdigit())
        if len(self.cn8_code) < 2:
            raise ValueError("cn8_code must contain at least 2 digits")
        if self.emissions_method == "actual" and self.actual_see_tco2e_per_t is None:
            raise ValueError(
                "actual_see_tco2e_per_t is required when emissions_method is 'actual'"
            )
        if (
            self.actual_see_tco2e_per_t is not None
            and self.actual_see_tco2e_per_t < 0
        ):
            raise ValueError("actual_see_tco2e_per_t must be >= 0")
        return self


# ── Router ──────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/public", tags=["public-tools"])

# No auth dependencies on any endpoint in this router.


# ── CN Code Lookup (autocomplete) ───────────────────────────────────────────────

@router.get(
    "/cbam-cn-lookup",
    summary="CN code autocomplete",
    description=(
        "Search CBAM in-scope CN codes by prefix.  Returns up to 10 matching "
        "world-average default SEE entries from Annex VI.  No auth required."
    ),
)
def cn_lookup(
    request: Request,
    q: str = Query("", max_length=20, description="CN code prefix (digits only)"),
) -> dict:
    _check_rate(_client_ip(request))

    q_clean = "".join(ch for ch in q if ch.isdigit())[:8]
    if len(q_clean) < 2:
        return {"results": []}

    return {
        "results": _cn_search(q_clean),
        "source": "EU 2023/1773 Annex VI (DG TAXUD Art. 4(3) default values, Dec 2023)",
    }


# ── Scope Checker ───────────────────────────────────────────────────────────────

@router.post(
    "/cbam-scope-check",
    summary="CBAM scope check",
    description=(
        "Check whether a commodity code is in scope for UK and/or EU CBAM and "
        "whether the annual import value triggers the £50,000 registration threshold."
    ),
)
def scope_check(request: Request, body: ScopeCheckRequest) -> dict:
    _check_rate(_client_ip(request))

    entry, _matched_prefix = _resolve_see(body.cn8_code)

    if entry is None:
        return {
            "in_scope": False,
            "regime": body.regime,
            "sector": None,
            "cn_description": None,
            "registration_required": False,
            "reason": (
                f"CN code {body.cn8_code!r} is not classified as a CBAM commodity "
                f"under UK CBAM (Finance No.2 Bill 2025-26) or EU CBAM "
                f"(Regulation (EU) 2023/956). No CBAM reporting obligation applies."
            ),
            "first_return_due": None,
            "default_see_tco2e_per_t": None,
            "next_steps": [
                "Confirm the CN code with your freight forwarder or HMRC Trade Tariff",
                "Review the UK CBAM commodities list on the HMRC website",
                _STEP_CTA,
            ],
        }

    # Threshold assessment
    gbp = body.annual_import_value_gbp
    registration_required = gbp >= _UK_THRESHOLD_GBP
    approaching = _UK_APPROACHING_GBP <= gbp < _UK_THRESHOLD_GBP

    if registration_required:
        reason = (
            f"Annual import value of £{gbp:,.0f} exceeds the £50,000 "
            f"UK CBAM registration threshold for {entry.sector.replace('_', ' ')} imports. "
            "You must register with HMRC."
        )
    elif approaching:
        reason = (
            f"Annual import value of £{gbp:,.0f} is approaching the £50,000 "
            "UK CBAM registration threshold. Prepare your EORI number and "
            "Government Gateway credentials now."
        )
    else:
        reason = (
            f"Annual import value of £{gbp:,.0f} is below the £50,000 "
            "UK CBAM registration threshold. No registration action required at this time. "
            "Check monthly on the first of each month."
        )

    # First return due date
    if body.regime == "UK":
        first_return_due = _UK_FIRST_RETURN.isoformat()
    elif body.regime == "EU":
        first_return_due = _EU_FIRST_RETURN.isoformat()
    else:  # BOTH — show earlier EU date
        first_return_due = _EU_FIRST_RETURN.isoformat()

    total_see = float(
        (entry.total_tco2e_per_t).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    )

    return {
        "in_scope": True,
        "regime": body.regime,
        "sector": entry.sector,
        "cn_description": entry.description,
        "registration_required": registration_required,
        "approaching_threshold": approaching,
        "reason": reason,
        "first_return_due": first_return_due,
        "default_see_tco2e_per_t": total_see,
        "direct_see_tco2e_per_t": float(
            entry.direct_tco2e_per_t.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
        ),
        "indirect_see_tco2e_per_t": float(
            entry.indirect_tco2e_per_t.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
        ),
        "source_ref": entry.source_ref,
        "next_steps": _build_next_steps(entry.sector, registration_required, body.regime),
    }


# ── Liability Estimator ─────────────────────────────────────────────────────────

@router.post(
    "/cbam-liability-estimate",
    summary="CBAM liability estimate",
    description=(
        "Estimate annual CBAM liability using Annex VI default SEE values or "
        "a caller-supplied actual emissions intensity.  No auth required."
    ),
)
def liability_estimate(request: Request, body: LiabilityRequest) -> dict:
    _check_rate(_client_ip(request))

    entry, _matched_prefix = _resolve_see(body.cn8_code)

    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"CN code {body.cn8_code!r} is not a CBAM commodity — "
                "no Annex VI default SEE value is published for this code."
            ),
        )

    # Select ETS rate based on regime
    if body.regime == "EU":
        ets_rate = _EU_ETS_RATE
        rate_source = _EU_ETS_RATE_SOURCE
    else:
        ets_rate = _UK_ETS_RATE
        rate_source = _UK_ETS_RATE_SOURCE

    # Emissions intensity
    if body.emissions_method == "actual" and body.actual_see_tco2e_per_t is not None:
        see_tco2e_per_t: Decimal = body.actual_see_tco2e_per_t
        markup_note: str | None = None
    else:
        see_tco2e_per_t = entry.total_tco2e_per_t
        markup_note = (
            "10% surcharge applied to default SEE when claiming liability reduction — "
            "using actual (verified) data removes this loading"
        )

    # Core calculation
    t = body.annual_import_tonnes.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    total_embedded = (t * see_tco2e_per_t).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    gross_liability = (total_embedded * ets_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    # Default-method surcharge and potential saving from switching to actual data
    if body.emissions_method == "default":
        # Gross shown is the base; the 10% markup is what you avoid with actual data
        actual_data_saving = (gross_liability * _DEFAULT_MARKUP).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
    else:
        # Actual data already used — compute what the default liability would have been
        default_total = (t * entry.total_tco2e_per_t).quantize(Decimal("0.01"))
        default_liability = (default_total * ets_rate).quantize(Decimal("0.01"))
        actual_data_saving = (default_liability - gross_liability).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        actual_data_saving = max(Decimal("0"), actual_data_saving)

    # Subscription comparison
    sub_comparison: dict | None = None
    if gross_liability > 0:
        pct = (
            (_PROFESSIONAL_TIER_GBP / gross_liability * 100)
            .quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        )
        sub_comparison = {
            "professional_tier_gbp": int(_PROFESSIONAL_TIER_GBP),
            "as_percentage_of_liability": f"{pct}%",
            "message": (
                f"A Professional tier subscription (£{int(_PROFESSIONAL_TIER_GBP):,}/year) "
                f"represents {pct}% of your estimated annual CBAM liability"
            ),
        }

    return {
        "cn8_code": body.cn8_code,
        "sector": entry.sector,
        "cn_description": entry.description,
        "annual_import_tonnes": float(t),
        "emissions_intensity_tco2e_per_t": float(
            see_tco2e_per_t.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
        ),
        "emissions_method": body.emissions_method,
        "total_embedded_tco2e": float(total_embedded),
        "cbam_rate_gbp_per_tco2e": float(ets_rate),
        "cbam_rate_source": rate_source,
        "gross_cbam_liability_gbp": float(gross_liability),
        "default_value_markup": markup_note,
        "if_actual_data_saving_gbp": float(actual_data_saving),
        "annual_subscription_comparison": sub_comparison,
        "disclaimer": (
            "This is an estimate based on published UK/EU ETS reference prices and "
            "Annex VI world-average default emissions values (EU 2023/1773, DG TAXUD "
            "Dec 2023). Actual liability depends on verified supplier emissions data "
            "and the final CBAM rate published by HMRC each quarter. "
            "This tool does not constitute tax or legal advice."
        ),
    }
