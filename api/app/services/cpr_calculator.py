"""Carbon Price Relief (CPR) calculator — UK CBAM.

Implements the CPR formula from the Finance No.2 Bill 2025-26 secondary
legislation (February 2026):

    CPR (£) = verified_emissions_tco2e
              × effective_carbon_price_gbp

where:
    effective_carbon_price_gbp
        = (carbon_price_local − free_allocations − rebates) × exchange_rate_to_gbp

    free_allocations  — value of free CO₂e allowances issued to the installation,
                        per tonne of CO₂e; reduces the net carbon cost.
    rebates           — any direct cash rebates from the scheme authority,
                        per tonne of CO₂e.

CPR cannot reduce CBAM liability below zero (capped at cbam_liability_gbp).
Where multiple qualifying schemes apply to a single goods line, each scheme
is calculated separately and the total CPR is capped at the CBAM liability.

Verification requirement
------------------------
Emissions data used in a CPR claim must be verified by an independent verifier
that is:
  - Accredited by GACI (Gulf Accreditation Centre International) or
    an equivalent recognised accreditation body
  - Operating to ISO 17029 (conformity assessment — verification and validation)
  - ISO 14064-3 (GHG verification and validation)
  - ISO 14065 (requirements for validation / verification bodies)
  - ISO 14066 (competence requirements for verifiers)

Qualifying schemes (pre-seeded in cbam_qualifying_schemes)
----------------------------------------------------------
No UK-specific list has been published as of February 2026.  The calculator
is pre-loaded with EU ETS participants (27 EU member states + EEA: NO, IS, LI)
and the Swiss ETS (CH) as indicative qualifying schemes.  Run the lookup
function to check the DB for the authoritative current status.

Exchange rates
--------------
Importers must use the HMRC CDRM exchange rate prevailing on the date of
import.  Override rates are accepted with an explicit date for audit purposes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Sequence

__all__ = [
    "CPRValidationError",
    "CPRResult",
    "UKQualifyingScheme",
    "calculate_cpr",
    "calculate_total_cpr",
    "get_qualifying_schemes",
    "lookup_qualifying_schemes_db",
    "get_exchange_rate_db",
    "get_cpr_by_consignment_db",
]

# ── Constants ─────────────────────────────────────────────────────────────────

_GBP2  = Decimal("0.01")    # 2 d.p. for GBP amounts
_D4    = Decimal("0.0001")  # 4 d.p. for intermediate per-tonne prices
_D6    = Decimal("0.000001")
_ZERO  = Decimal("0")
_ONE   = Decimal("1")

# ── Exceptions ────────────────────────────────────────────────────────────────

class CPRValidationError(ValueError):
    """Raised when CPR inputs fail pre-calculation validation."""

    def __init__(self, failures: list[str]) -> None:
        self.failures: list[str] = failures
        super().__init__(f"CPR validation failed: {'; '.join(failures)}")


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class CPRResult:
    """Complete CPR calculation — all inputs and derived values for audit trail.

    The ``warnings`` list surfaces non-blocking issues (e.g. a capped claim)
    that the importer should review before including in a HMRC return.
    """
    # Inputs (stored verbatim for audit)
    verified_emissions_tco2e:     Decimal
    carbon_price_local:           Decimal
    currency_code:                str
    free_allocations:             Decimal
    rebates:                      Decimal
    exchange_rate_to_gbp:         Decimal
    cbam_liability_gbp:           Decimal

    # Derived (independently re-derivable from inputs — stored for convenience)
    net_price_local:              Decimal   # ≥ 0; clamped if allocs+rebates > price
    effective_carbon_price_gbp:   Decimal   # net_price_local × exchange_rate_to_gbp
    cpr_raw_gbp:                  Decimal   # verified_emissions × effective_price
    cpr_capped:                   bool      # True when raw CPR > CBAM liability
    cpr_amount_gbp:               Decimal   # min(cpr_raw_gbp, cbam_liability_gbp)

    # GACI verification provenance — mandatory per CLAUDE.md Rule 7.
    # Stored verbatim so a regulator auditing the declaration can verify the
    # accreditation body used (HMRC / GACI / ISO 17029 requirement).
    verifier_accreditation_body:  str | None = None

    warnings: list[str] = field(default_factory=list)


# ── Qualifying scheme registry ─────────────────────────────────────────────────

@dataclass(frozen=True)
class UKQualifyingScheme:
    """A carbon pricing scheme recognised for UK CBAM CPR purposes."""
    country_code:       str
    scheme_name:        str
    scheme_type:        str   # 'ets' | 'carbon_tax' | 'hybrid'
    recognition_status: str   # 'confirmed' | 'pending' | 'not_recognised'
    notes:              str = ""


def _eu_ets(country_code: str, extra_note: str = "") -> UKQualifyingScheme:
    note = "Full EU ETS participant (Directive 2003/87/EC)."
    if extra_note:
        note += f" {extra_note}"
    return UKQualifyingScheme(
        country_code=country_code,
        scheme_name="EU Emissions Trading System (EU ETS)",
        scheme_type="ets",
        recognition_status="confirmed",
        notes=note,
    )


# In-memory registry — authoritative source is the DB (cbam_qualifying_schemes).
# Used as fallback when DB is unavailable and in unit tests.
_UK_QUALIFYING_SCHEMES: dict[str, list[UKQualifyingScheme]] = {
    # EU Member States
    "AT": [_eu_ets("AT")],
    "BE": [_eu_ets("BE")],
    "BG": [_eu_ets("BG")],
    "CY": [_eu_ets("CY")],
    "CZ": [_eu_ets("CZ")],
    "DE": [_eu_ets("DE")],
    "DK": [_eu_ets("DK")],
    "EE": [_eu_ets("EE")],
    "ES": [_eu_ets("ES")],
    "FI": [_eu_ets("FI")],
    "FR": [_eu_ets("FR")],
    "GR": [_eu_ets("GR")],
    "HR": [_eu_ets("HR")],
    "HU": [_eu_ets("HU")],
    "IE": [_eu_ets("IE")],
    "IT": [_eu_ets("IT")],
    "LT": [_eu_ets("LT")],
    "LU": [_eu_ets("LU")],
    "LV": [_eu_ets("LV")],
    "MT": [_eu_ets("MT")],
    "NL": [_eu_ets("NL")],
    "PL": [_eu_ets("PL")],
    "PT": [_eu_ets("PT")],
    "RO": [_eu_ets("RO")],
    "SE": [
        _eu_ets("SE", "Also operates a national carbon tax (non-ETS sectors)."),
        UKQualifyingScheme(
            country_code="SE",
            scheme_name="Swedish Carbon Tax",
            scheme_type="carbon_tax",
            recognition_status="confirmed",
            notes="Applies to sectors not covered by EU ETS. Rate set annually by Swedish government.",
        ),
    ],
    "SI": [_eu_ets("SI")],
    "SK": [_eu_ets("SK")],
    # EEA non-EU (EU ETS under EEA Agreement Annex XX)
    "NO": [_eu_ets("NO", "EEA participant. Carbon price denominated in EUR.")],
    "IS": [_eu_ets("IS", "EEA participant. Carbon price denominated in EUR.")],
    "LI": [_eu_ets("LI", "EEA participant. Carbon price denominated in EUR.")],
    # Switzerland — linked ETS
    "CH": [
        UKQualifyingScheme(
            country_code="CH",
            scheme_name="Swiss Emissions Trading Scheme (Swiss ETS)",
            scheme_type="ets",
            recognition_status="confirmed",
            notes=(
                "Linked to EU ETS since 2020 (CH-EU ETS Agreement). "
                "Allowances fungible with EU EUAs. "
                "Carbon price denominated in CHF."
            ),
        )
    ],
}

# Pending: UK-EU ETS formal linking is under discussion (2026).
# When agreed, this will affect the CPR calculation methodology.
_UK_EU_ETS_LINKING_STATUS = "pending"


def get_qualifying_schemes(country_code: str) -> list[UKQualifyingScheme]:
    """Return the in-memory list of qualifying schemes for an origin country.

    Returns an empty list if the country has no recognised UK CBAM CPR scheme.
    This uses the in-memory registry; for production use ``lookup_qualifying_schemes_db``.
    """
    return _UK_QUALIFYING_SCHEMES.get(country_code.upper().strip(), [])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _gbp(value: Decimal) -> Decimal:
    """Round to 2 decimal places (GBP pence) using ROUND_HALF_UP."""
    return value.quantize(_GBP2, rounding=ROUND_HALF_UP)


def _local(value: Decimal) -> Decimal:
    """Round a per-tonne local currency price to 4 decimal places."""
    return value.quantize(_D4, rounding=ROUND_HALF_UP)


def _to_d(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _validate_inputs(
    verified_emissions_tco2e: Decimal,
    carbon_price_local: Decimal,
    currency_code: str,
    free_allocations: Decimal,
    rebates: Decimal,
    exchange_rate_to_gbp: Decimal,
    cbam_liability_gbp: Decimal,
) -> list[str]:
    failures: list[str] = []
    if verified_emissions_tco2e <= _ZERO:
        failures.append("verified_emissions_tco2e must be > 0")
    if carbon_price_local < _ZERO:
        failures.append("carbon_price_local must be ≥ 0")
    if free_allocations < _ZERO:
        failures.append("free_allocations must be ≥ 0")
    if rebates < _ZERO:
        failures.append("rebates must be ≥ 0")
    if exchange_rate_to_gbp <= _ZERO:
        failures.append("exchange_rate_to_gbp must be > 0")
    if cbam_liability_gbp < _ZERO:
        failures.append("cbam_liability_gbp must be ≥ 0")
    if not currency_code or len(currency_code.strip()) != 3:
        failures.append("currency_code must be a 3-letter ISO 4217 code (e.g. 'EUR')")
    return failures


# ── Main calculation ──────────────────────────────────────────────────────────

def calculate_cpr(
    verified_emissions_tco2e: Decimal,
    carbon_price_local: Decimal,
    currency_code: str,
    free_allocations: Decimal,
    rebates: Decimal,
    exchange_rate_to_gbp: Decimal,
    cbam_liability_gbp: Decimal,
    verifier_accreditation_body: str | None = None,
) -> CPRResult:
    """Calculate Carbon Price Relief for a single qualifying scheme.

    Parameters
    ----------
    verified_emissions_tco2e:
        Embedded emissions (tCO₂e) verified by a GACI-accredited body to
        ISO 17029 / ISO 14064-3 / ISO 14065 / ISO 14066.
    carbon_price_local:
        Carbon price paid per tonne CO₂e in the origin country's scheme,
        expressed in the scheme's local currency (e.g. EUR for EU ETS).
    currency_code:
        ISO 4217 code of the local currency (e.g. "EUR", "CHF").
    free_allocations:
        Value of free CO₂e allowances received by the installation per tonne
        CO₂e of product.  Reduces the effective carbon price.  Pass 0 when
        the installation received no free allocations.
    rebates:
        Direct cash rebates received from the scheme authority per tonne CO₂e.
        Pass 0 when no rebates were received.
    exchange_rate_to_gbp:
        HMRC CDRM exchange rate from ``currency_code`` to GBP, valid on the
        date of import.  Use ``get_exchange_rate_db()`` to retrieve the
        HMRC reference rate.
    cbam_liability_gbp:
        CBAM liability (£) for this goods line.  CPR is capped at this value
        (cannot reduce liability below zero).

    Returns
    -------
    CPRResult
        All inputs and derived values.  The ``warnings`` list is non-empty
        when the claim was capped or the effective carbon price is zero.

    Raises
    ------
    CPRValidationError
        If any input fails basic validation.
    """
    # Normalise to Decimal
    verified_emissions_tco2e = _to_d(verified_emissions_tco2e)
    carbon_price_local        = _to_d(carbon_price_local)
    free_allocations          = _to_d(free_allocations)
    rebates                   = _to_d(rebates)
    exchange_rate_to_gbp      = _to_d(exchange_rate_to_gbp)
    cbam_liability_gbp        = _to_d(cbam_liability_gbp)

    failures = _validate_inputs(
        verified_emissions_tco2e, carbon_price_local, currency_code,
        free_allocations, rebates, exchange_rate_to_gbp, cbam_liability_gbp,
    )
    if failures:
        raise CPRValidationError(failures)

    warnings: list[str] = []

    # ── GACI accreditation check (CLAUDE.md Rule 7) ───────────────────────────
    # CPR requires independent verification by a GACI-accredited body operating
    # to ISO 17029 / ISO 14064-3 / ISO 14065 / ISO 14066.
    # If verifier_accreditation_body is not supplied, we cannot confirm the CPR
    # claim is regulatorily defensible — surface as a compliance warning rather
    # than a hard failure so that callers without the verifier form on hand can
    # still compute the monetary amount for planning purposes.
    if not verifier_accreditation_body or not verifier_accreditation_body.strip():
        warnings.append(
            "cpr_gaci_missing: verifier_accreditation_body not provided — "
            "CPR requires independent verification by a GACI-accredited body "
            "(ISO 17029 / ISO 14064-3 / ISO 14065 / ISO 14066). "
            "This claim cannot be included in a HMRC return without a "
            "completed carbon pricing verification form. "
            "(Finance No.2 Bill 2025-26, CLAUDE.md Rule 7)"
        )
    gaci_body = (verifier_accreditation_body or "").strip() or None

    # Step 1: effective carbon price in local currency (per tCO₂e)
    #   net_price = carbon_price_local - free_allocations - rebates
    #   Clamped to 0: if the installation received more in free allowances than
    #   the scheme price, their net cost is zero — no CPR can be claimed.
    gross_deductions = free_allocations + rebates
    if gross_deductions > carbon_price_local:
        warnings.append(
            "cpr_net_price_clamped_to_zero: free_allocations + rebates exceed "
            f"carbon_price_local ({gross_deductions} > {carbon_price_local} "
            f"{currency_code}/tCO₂e) — effective carbon price is zero; no CPR claimable"
        )
    net_price_local = max(_ZERO, carbon_price_local - free_allocations - rebates)
    net_price_local = _local(net_price_local)

    # Step 2: convert to GBP
    #   effective_carbon_price_gbp = net_price_local × exchange_rate_to_gbp
    effective_carbon_price_gbp = _local(net_price_local * exchange_rate_to_gbp)

    if effective_carbon_price_gbp == _ZERO:
        warnings.append(
            "cpr_effective_price_zero: effective carbon price in GBP is zero; "
            "CPR amount will be £0.00"
        )

    # Step 3: CPR before cap
    #   cpr_raw = verified_emissions × effective_carbon_price_gbp
    cpr_raw_gbp = _gbp(verified_emissions_tco2e * effective_carbon_price_gbp)

    # Step 4: cap at CBAM liability
    cpr_capped = cpr_raw_gbp > cbam_liability_gbp
    cpr_amount_gbp = _gbp(min(cpr_raw_gbp, cbam_liability_gbp))

    if cpr_capped:
        warnings.append(
            f"cpr_capped: raw CPR (£{cpr_raw_gbp}) exceeds CBAM liability "
            f"(£{cbam_liability_gbp}); capped at £{cpr_amount_gbp}"
        )

    return CPRResult(
        verified_emissions_tco2e=verified_emissions_tco2e,
        carbon_price_local=carbon_price_local,
        currency_code=currency_code.upper().strip(),
        free_allocations=free_allocations,
        rebates=rebates,
        exchange_rate_to_gbp=exchange_rate_to_gbp,
        cbam_liability_gbp=cbam_liability_gbp,
        net_price_local=net_price_local,
        effective_carbon_price_gbp=effective_carbon_price_gbp,
        cpr_raw_gbp=cpr_raw_gbp,
        cpr_capped=cpr_capped,
        cpr_amount_gbp=cpr_amount_gbp,
        verifier_accreditation_body=gaci_body,
        warnings=warnings,
    )


def calculate_total_cpr(
    results: Sequence[CPRResult],
    cbam_liability_gbp: Decimal,
) -> tuple[Decimal, bool, list[str]]:
    """Sum CPR amounts across multiple qualifying schemes and apply the total cap.

    Where multiple qualifying schemes apply to a single goods line, each must be
    calculated separately (Finance No.2 Bill 2025-26).  The *total* CPR across
    all schemes is then capped at the CBAM liability for the goods line.

    Parameters
    ----------
    results:
        Sequence of ``CPRResult`` objects, one per qualifying scheme.
    cbam_liability_gbp:
        CBAM liability (£) for the goods line — the overall cap.

    Returns
    -------
    (total_cpr_gbp, was_capped, aggregate_warnings)
    """
    cbam_liability_gbp = _to_d(cbam_liability_gbp)
    total_raw = _gbp(sum(r.cpr_amount_gbp for r in results))
    was_capped = total_raw > cbam_liability_gbp
    total_cpr = _gbp(min(total_raw, cbam_liability_gbp))

    aggregate_warnings: list[str] = []
    for r in results:
        aggregate_warnings.extend(r.warnings)
    if was_capped:
        aggregate_warnings.append(
            f"cpr_total_capped: sum of per-scheme CPR (£{total_raw}) exceeds "
            f"CBAM liability (£{cbam_liability_gbp}); total capped at £{total_cpr}"
        )

    return total_cpr, was_capped, aggregate_warnings


# ── DB helpers (require a live SQLAlchemy connection) ─────────────────────────

def lookup_qualifying_schemes_db(conn: Any, country_code: str) -> list[dict[str, Any]]:
    """Query ``cbam.cbam_qualifying_schemes`` for a given country code.

    Parameters
    ----------
    conn:
        An open SQLAlchemy ``Connection``.
    country_code:
        ISO 3166-1 alpha-2 code (e.g. "DE").

    Returns
    -------
    List of row dicts (may be empty — means no recognised scheme).
    """
    from sqlalchemy import text  # local import — keeps module importable without SA

    rows = conn.execute(
        text(
            """
            SELECT country_code, scheme_name, scheme_type,
                   recognition_status, effective_from, effective_to, notes
            FROM   cbam.cbam_qualifying_schemes
            WHERE  country_code = :country_code
            ORDER BY scheme_type, scheme_name
            """
        ),
        {"country_code": country_code.upper().strip()},
    ).mappings().all()

    return [dict(r) for r in rows]


def get_exchange_rate_db(
    conn: Any,
    from_currency: str,
    target_date: date,
    to_currency: str = "GBP",
) -> tuple[Decimal, date, str]:
    """Retrieve the most recent HMRC exchange rate on or before ``target_date``.

    Parameters
    ----------
    conn:
        An open SQLAlchemy ``Connection``.
    from_currency:
        ISO 4217 source currency code (e.g. "EUR").
    target_date:
        The date on which the exchange rate should apply (typically import date).
    to_currency:
        ISO 4217 target currency (default: "GBP").

    Returns
    -------
    (rate, effective_date, source)

    Raises
    ------
    LookupError
        When no rate is found for the currency pair and date range.
    """
    from sqlalchemy import text

    # GBP identity — no lookup needed
    if from_currency.upper().strip() == to_currency.upper().strip():
        return _ONE, target_date, "IDENTITY"

    rows = conn.execute(
        text(
            """
            SELECT rate, effective_date, source
            FROM   cbam.cbam_exchange_rates
            WHERE  from_currency = :from_currency
              AND  to_currency   = :to_currency
              AND  effective_date <= :target_date
            ORDER BY effective_date DESC
            LIMIT 1
            """
        ),
        {
            "from_currency": from_currency.upper().strip(),
            "to_currency": to_currency.upper().strip(),
            "target_date": target_date,
        },
    ).mappings().all()

    if not rows:
        raise LookupError(
            f"No HMRC exchange rate found for {from_currency} → {to_currency} "
            f"on or before {target_date}. "
            "Seed the cbam_exchange_rates table or supply an override rate."
        )

    row = dict(rows[0])
    return Decimal(str(row["rate"])), row["effective_date"], str(row["source"])


def get_cpr_by_consignment_db(
    conn: Any,
    case_id: str,
    tenant_id: str,
) -> dict[str, Decimal]:
    """Sum confirmed CPR claims per consignment for a case.

    Joins cbam_cpr_claims → cbam_goods_lines → cbam_shipments to resolve
    each claim to its consignment reference.  Replicates the same fallback
    priority used by hmrc_return_builder._consignment_ref:
      1. cbam_shipments.consignment_reference  (migration 008)
      2. cbam_shipments.entry_reference
      3. 'SHIP-' + first 12 chars of shipment UUID

    Returns
    -------
    dict mapping consignment_ref → total cpr_amount_gbp (Decimal).
    Empty dict when no CPR claims exist for the case.

    Parameters
    ----------
    conn:
        Open SQLAlchemy ``Connection`` with tenant context already set.
    case_id:
        UUID string of the cbam_case.
    tenant_id:
        Caller's tenant UUID — filters claims to the correct tenant.
    """
    from sqlalchemy import text as _text  # local import — keeps module importable without SA

    rows = conn.execute(
        _text(
            """
            SELECT
                COALESCE(
                    sh.consignment_reference,
                    sh.entry_reference,
                    'SHIP-' || LEFT(sh.id::text, 12)
                )                        AS consignment_ref,
                SUM(c.cpr_amount_gbp)    AS total_cpr_gbp
            FROM   cbam.cbam_cpr_claims   c
            JOIN   cbam.cbam_goods_lines  gl ON gl.id = c.goods_line_id
            JOIN   cbam.cbam_shipments    sh ON sh.id = gl.shipment_id
            WHERE  sh.case_id   = :case_id
              AND  c.tenant_id  = :tenant_id
            GROUP  BY consignment_ref
            """
        ),
        {"case_id": case_id, "tenant_id": tenant_id},
    ).mappings().all()

    return {str(r["consignment_ref"]): _gbp(Decimal(str(r["total_cpr_gbp"]))) for r in rows}
