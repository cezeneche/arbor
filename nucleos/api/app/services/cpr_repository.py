"""CPR persistence — the queries the calculator deliberately does not do.

`cpr_calculator` is pure: given values, it returns a result. These three
functions need a live SQLAlchemy Connection, and keeping them in the same module
meant the calculator could not be called without a database even to compute an
arithmetic result.

Splitting them is what lets the calculation run as a pure service behind
POST /internal/calculate. Nothing here changed except which file it lives in.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from app.services.cpr_calculator import _ONE, _gbp


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


def get_cpr_by_goods_line_db(
    conn: Any,
    case_id: str,
    tenant_id: str,
) -> dict[str, Decimal]:
    """The relief each goods line of a case carries onto the HMRC return.

    One claim per goods line: the latest. Claiming again for a line — to
    correct a mistyped price, say — replaces the earlier claim; summing every
    claim added the correction to the mistake and doubled the relief.

    Only a claim with its verifier's statement attached counts. Relief requires
    independent verification of the carbon price paid (Finance (No.2) Bill
    2025-26); an unverified claim stays on record but does not reduce the return.

    The amounts are as claimed. The HMRC return builder caps each at the line's
    own CBAM charge.

    Returns
    -------
    dict mapping goods_line_id → cpr_amount_gbp (Decimal). Empty when no line
    carries verified relief.
    """
    from sqlalchemy import text as _text  # local import — keeps module importable without SA

    rows = conn.execute(
        _text(
            """
            WITH latest AS (
                SELECT DISTINCT ON (c.goods_line_id)
                       c.goods_line_id, c.cpr_amount_gbp, c.verification_document_hash
                FROM   cbam.cbam_cpr_claims c
                WHERE  c.tenant_id = :tenant_id
                ORDER  BY c.goods_line_id, c.created_at DESC, c.id DESC
            )
            SELECT l.goods_line_id, l.cpr_amount_gbp
            FROM   latest                 l
            JOIN   cbam.cbam_goods_lines  gl ON gl.id = l.goods_line_id
            JOIN   cbam.cbam_shipments    sh ON sh.id = gl.shipment_id
            WHERE  sh.case_id = :case_id
              AND  l.verification_document_hash IS NOT NULL
            """
        ),
        {"case_id": case_id, "tenant_id": tenant_id},
    ).mappings().all()

    return {str(r["goods_line_id"]): _gbp(Decimal(str(r["cpr_amount_gbp"]))) for r in rows}
