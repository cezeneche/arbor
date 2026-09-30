"""Reading HMRC's published monthly exchange rates.

HMRC publishes one file per month (trade-tariff.service.gov.uk,
/api/v2/exchange_rates/files/monthly_csv_YYYY-M.csv), giving currency units per
£1 for the calendar month. Several countries share a currency (every eurozone
country lists EUR), and they must agree; a disagreement is refused rather than
resolved by picking one.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.hmrc_exchange_rates import gbp_per_unit, parse_monthly_csv, render_rates_module

pytestmark = pytest.mark.regulatory

CSV = """Country/Territories,Currency,Currency Code,Currency Units per £1,Start date,End date
Austria,Euro,EUR,1.1570,01/04/2026,30/04/2026
Belgium,Euro,EUR,1.1570,01/04/2026,30/04/2026
Switzerland,Franc,CHF,1.0712,01/04/2026,30/04/2026
Sweden,Krona,SEK,12.9006,01/04/2026,30/04/2026
"""


def test_reads_units_per_pound_for_each_currency_once():
    assert parse_monthly_csv(CSV, 2026, 4) == {
        "CHF": Decimal("1.0712"),
        "EUR": Decimal("1.1570"),
        "SEK": Decimal("12.9006"),
    }


def test_refuses_a_currency_listed_with_two_different_rates():
    bad = CSV + "Finland,Euro,EUR,1.1571,01/04/2026,30/04/2026\n"
    with pytest.raises(ValueError, match="EUR"):
        parse_monthly_csv(bad, 2026, 4)


def test_refuses_a_file_for_a_different_month():
    with pytest.raises(ValueError, match="2026-05"):
        parse_monthly_csv(CSV, 2026, 5)


def test_converts_hmrcs_units_per_pound_to_pounds_per_unit():
    # 1 / 1.1570 = 0.864304...
    assert gbp_per_unit(Decimal("1.1570")) == Decimal("0.864304")


def test_renders_a_sorted_module_that_reproduces_the_rows():
    rows = {"2026-04": {"EUR": Decimal("1.1570"), "CHF": Decimal("1.0712")}}
    source = render_rates_module(rows)
    namespace: dict = {}
    exec(source, namespace)
    assert namespace["HMRC_MONTHLY_UNITS_PER_GBP"] == (
        ("2026-04", "CHF", "1.0712"),
        ("2026-04", "EUR", "1.1570"),
    )
