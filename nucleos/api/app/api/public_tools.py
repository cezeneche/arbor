"""Public CBAM commodity-code lookup — no authentication required.

GET  /api/public/cbam-cn-lookup?q={prefix}
    Autocomplete: CN codes whose prefix overlaps the query, from the in-memory
    Annex VI factor table (Commission Implementing Regulation (EU) 2023/1773).
    No JWT, no tenant, no database. Arbor's default-value lookup calls it.

Rate limit: 30 requests per rolling 60-second window per client IP.

The public scope checker and liability estimate that shared this module served
the Nucleos marketing page, and were removed on 27 September 2026
(docs/audits/2026-09-27-nucleos-endpoints.md). Arbor's own scope check goes
through the authenticated /api/cbam/scope-check.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, Request, status

# Regulatory constants

_UK_THRESHOLD_GBP: Decimal = Decimal("50000.00")
_UK_APPROACHING_GBP: Decimal = Decimal("40000.00")

# EU CBAM registration threshold: 50 tonnes net mass per year (Regulation (EU) 2023/956 Art. 2(3))
_EU_THRESHOLD_TONNES: Decimal = Decimal("50")
_EU_APPROACHING_TONNES: Decimal = Decimal("40")

# UK ETS Q1 2027 quarterly-average allowance price — engineering estimate only.
# HMRC has not yet published operative CBAM rates; replace when published.
_UK_ETS_RATE: Decimal = Decimal("52.40")
_UK_ETS_RATE_SOURCE: str = "UK ETS Q1 2027 quarterly average (engineering estimate — HMRC rate not yet published)"

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

# Rate limiting

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


# Sector-specific next-step templates

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


# Emission factor helpers

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


# Pydantic request models


# Router

router = APIRouter(prefix="/public", tags=["public-tools"])

# No auth dependencies on any endpoint in this router.


# CN Code Lookup (autocomplete)

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


# Scope Checker
