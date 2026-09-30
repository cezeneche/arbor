"""Reading HMRC's published monthly exchange rates into Nucleos's reference table.

HMRC publishes one file per month at
https://www.trade-tariff.service.gov.uk/api/v2/exchange_rates/files/monthly_csv_YYYY-M.csv,
giving currency units per £1 for that calendar month. It is published before the
month starts. scripts/update_hmrc_rates.py fetches new months and regenerates
app/services/hmrc_exchange_rates_data.py; cpr_reference reads that module.

Months already held are never rewritten (insert-never-update): a relief figure
stamped with a table version must stay reproducible.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

SOURCE_URL = "https://www.trade-tariff.service.gov.uk/api/v2/exchange_rates/files/monthly_csv_{year}-{month}.csv"
SOURCE = "HMRC monthly exchange rates (trade-tariff.service.gov.uk)"

# £ per unit is stored to six places: a relative error below one part in a
# million on a relief figure, against HMRC's four-place units-per-£ figure.
_GBP_PER_UNIT_PLACES = Decimal("0.000001")


def gbp_per_unit(units_per_gbp: Decimal) -> Decimal:
    """HMRC publishes units per £1; relief converts a local price to £."""
    return (Decimal(1) / units_per_gbp).quantize(_GBP_PER_UNIT_PLACES, rounding=ROUND_HALF_UP)


def parse_monthly_csv(text: str, year: int, month: int) -> dict[str, Decimal]:
    """Currency code → units per £1 for one month's file.

    Refuses a file whose dates are not the requested month, and a currency
    listed with two different rates (several countries share a currency).
    """
    rates: dict[str, Decimal] = {}
    for row in csv.DictReader(io.StringIO(text)):
        start = datetime.strptime(row["Start date"].strip(), "%d/%m/%Y").date()
        if (start.year, start.month) != (year, month):
            raise ValueError(f"The file covers {start:%Y-%m}, not {year}-{month:02d}.")
        code = row["Currency Code"].strip().upper()
        units = Decimal(row["Currency Units per £1"].strip())
        if units <= 0:
            raise ValueError(f"{code} has a non-positive rate {units} in {year}-{month:02d}.")
        if code in rates and rates[code] != units:
            raise ValueError(f"{code} is listed at both {rates[code]} and {units} in {year}-{month:02d}.")
        rates[code] = units
    if not rates:
        raise ValueError(f"The file for {year}-{month:02d} holds no rates.")
    return dict(sorted(rates.items()))


def render_rates_module(rows: dict[str, dict[str, Decimal]]) -> str:
    """The generated data module: (month, currency, units per £1), sorted."""
    lines = [
        '"""HMRC monthly exchange rates, as published. Generated — do not edit.',
        "",
        "Regenerate with: python scripts/update_hmrc_rates.py",
        f"Source: {SOURCE}.",
        "Each row is (month, currency code, currency units per £1).",
        '"""',
        "",
        "HMRC_MONTHLY_UNITS_PER_GBP: tuple[tuple[str, str, str], ...] = (",
    ]
    for month in sorted(rows):
        for code in sorted(rows[month]):
            lines.append(f'    ("{month}", "{code}", "{rows[month][code]}"),')
    lines.append(")")
    return "\n".join(lines) + "\n"
