"""HMRC's exchange rate for a relief claim, from Nucleos's reference table.

A relief claim converts the carbon price paid into sterling at HMRC's rate for
the import date. HMRC publishes one rate per currency per calendar month, so
only that month's rate is HMRC's rate for the date: an earlier month's is a
different figure that would look right. When the table does not hold the
month, the answer is "not held", never the nearest rate it does hold.
"""
from __future__ import annotations

import calendar

from app.services.hmrc_exchange_rates_data import HMRC_MONTHLY_UNITS_PER_GBP
from fastapi.testclient import TestClient
from main import app
from shared_auth.testing import make_test_token

client = TestClient(app)
HEADERS = {"Authorization": f"Bearer {make_test_token(sub='t', tenant_id='t', scopes=['cbam:read'])}"}


def _get(currency: str, day: str):
    return client.get(f"/api/cbam/cpr/exchange-rate?currency={currency}&date={day}", headers=HEADERS)


def test_the_rate_for_the_month_of_the_date():
    res = _get("eur", "2026-04-15")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["currency"] == "EUR"
    assert body["rate"] == "0.864304"  # HMRC, April 2026: EUR 1.1570 per £1
    assert body["effective_from"] == "2026-04-01"
    assert body["table_version"]


def _first_month_not_held() -> tuple[int, int]:
    """The month after the newest one in the table. Worked out from the table,
    not written in: a fixed date stops being unpublished the day HMRC publishes
    it, and this test then blocked the weekly job from proposing that month."""
    year, month = map(int, max(row[0] for row in HMRC_MONTHLY_UNITS_PER_GBP).split("-"))
    return (year + 1, 1) if month == 12 else (year, month + 1)


def test_an_earlier_months_rate_is_not_offered_as_this_months():
    # The next month's rate is HMRC's figure for that month, which the table does
    # not hold yet. The newest month it does hold must not stand in for it.
    year, month = _first_month_not_held()
    res = _get("EUR", f"{year}-{month:02d}-15")
    assert res.status_code == 404
    assert f"{calendar.month_name[month]} {year}" in res.json()["detail"]


def test_a_currency_hmrc_does_not_publish():
    assert _get("ZWL", "2026-04-15").status_code == 404


def test_a_malformed_date_is_refused():
    assert _get("EUR", "15/04/2026").status_code == 422
