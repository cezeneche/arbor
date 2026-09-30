"""Fetch HMRC's newly published monthly exchange rates into Nucleos.

Adds every month HMRC has published after the latest one held, then rewrites
api/app/services/hmrc_exchange_rates_data.py. Months already held are never
changed. With --check, exits non-zero when the current calendar month is not
held, which is how the scheduled workflow raises the alarm.

Usage (from nucleos/):
    python scripts/update_hmrc_rates.py            # fetch new months
    python scripts/update_hmrc_rates.py --check    # fail if this month is missing
"""
from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from datetime import date
from decimal import Decimal
from pathlib import Path

API = Path(__file__).resolve().parent.parent / "api"
sys.path.insert(0, str(API))

from app.services.hmrc_exchange_rates import SOURCE_URL, parse_monthly_csv, render_rates_module  # noqa: E402

DATA = API / "app" / "services" / "hmrc_exchange_rates_data.py"
FIRST_MONTH = (2026, 1)


def held() -> dict[str, dict[str, Decimal]]:
    rows: dict[str, dict[str, Decimal]] = {}
    if not DATA.exists():
        return rows
    namespace: dict = {}
    exec(DATA.read_text(encoding="utf-8"), namespace)
    for month, code, units in namespace["HMRC_MONTHLY_UNITS_PER_GBP"]:
        rows.setdefault(month, {})[code] = Decimal(units)
    return rows


def next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def fetch(year: int, month: int) -> str | None:
    request = urllib.request.Request(SOURCE_URL.format(year=year, month=month), headers={"User-Agent": "nucleos-rates"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read().decode("utf-8-sig")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None  # not published yet
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when the current month is not held")
    args = parser.parse_args()

    rows = held()
    if args.check:
        today = date.today()
        current = f"{today.year}-{today.month:02d}"
        if current not in rows:
            print(f"HMRC's rates for {current} are not held. Run scripts/update_hmrc_rates.py.")
            return 1
        print(f"HMRC's rates for {current} are held ({len(rows[current])} currencies).")
        return 0

    if rows:
        latest = max(rows)
        year, month = next_month(int(latest[:4]), int(latest[5:]))
    else:
        year, month = FIRST_MONTH

    added = []
    while True:
        text = fetch(year, month)
        if text is None:
            break
        key = f"{year}-{month:02d}"
        rows[key] = parse_monthly_csv(text, year, month)
        added.append(f"{key} ({len(rows[key])} currencies)")
        year, month = next_month(year, month)

    if not added:
        print(f"No new months. Latest held: {max(rows) if rows else 'none'}.")
        return 0
    DATA.write_text(render_rates_module(rows), encoding="utf-8")
    print("Added: " + ", ".join(added))
    return 0


if __name__ == "__main__":
    sys.exit(main())
