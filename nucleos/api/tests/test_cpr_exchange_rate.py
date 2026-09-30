"""HMRC's exchange rate for a relief claim, from Nucleos's reference table.

A relief claim converts the carbon price paid into sterling at HMRC's rate for
the import date. HMRC publishes one rate per currency per calendar month, so
only that month's rate is HMRC's rate for the date: an earlier month's is a
different figure that would look right. When the table does not hold the
month, the answer is "not held", never the nearest rate it does hold.
"""
from __future__ import annotations

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
    assert body["rate"] == "0.8365"
    assert body["effective_from"] == "2026-04-01"
    assert body["table_version"]


def test_an_earlier_months_rate_is_not_offered_as_this_months():
    # The table holds April; May's rate is HMRC's May figure, which it does not hold.
    res = _get("EUR", "2026-05-15")
    assert res.status_code == 404
    assert "May 2026" in res.json()["detail"]


def test_a_currency_the_table_does_not_hold():
    assert _get("SEK", "2026-04-15").status_code == 404


def test_a_malformed_date_is_refused():
    assert _get("EUR", "15/04/2026").status_code == 422
