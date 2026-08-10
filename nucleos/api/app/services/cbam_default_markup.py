"""CBAM default-value mark-up schedule.

Where no supplier data supports an actual figure, the declarant uses a published
default value.  Those defaults are deliberately conservative, and the EU adds a
further mark-up on top of them so that collecting real supplier data is always
cheaper than falling back to the default.

The mark-up applies to default values only.  An actual or estimated figure is
never marked up — doing so would penalise the supplier data the mechanism exists
to encourage.

Versioning
----------
Rows are inserted, never updated, in the same discipline as the Annex VI factor
table: a calculation stamped with MARKUP_TABLE_VERSION can be reproduced years
later.  When the schedule changes, add a new table version — do not edit these
values in place.

Jurisdiction
------------
The EU schedule is legislated.  The UK regime has not confirmed an equivalent
mark-up, so the UK entry is marked unconfirmed rather than recorded as zero: a
zero that is really an unknown would silently understate a UK default-method
figure, and the caller needs to be able to tell the two apart.

Regulation reference
--------------------
Regulation (EU) 2023/956 Article 7(2) and Annex IV (default values and mark-ups)
UK: Finance (No.2) Bill 2025-26 — no mark-up provision confirmed as at this
table version.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal

__all__ = [
    "MARKUP_TABLE_VERSION",
    "MARKUP_METADATA",
    "MarkupEntry",
    "MarkupResult",
    "EU_DEFAULT_VALUE_MARKUP",
    "get_default_value_markup",
    "apply_default_value_markup",
]

MARKUP_TABLE_VERSION = "2026-eu-v1"

_ZERO = Decimal("0")

_EU_REGULATION_REF = "Regulation (EU) 2023/956 Art. 7(2) + Annex IV"
_UK_REGULATION_REF = (
    "Finance (No.2) Bill 2025-26 — no default-value mark-up provision confirmed"
)


@dataclass(frozen=True)
class MarkupEntry:
    """One mark-up band. ``year_to=None`` means the band is open-ended."""

    jurisdiction: str
    year_from: int
    year_to: int | None
    fraction: Decimal
    regulation_ref: str

    def covers(self, year: int) -> bool:
        return year >= self.year_from and (self.year_to is None or year <= self.year_to)


@dataclass(frozen=True)
class MarkupResult:
    """A mark-up lookup outcome.

    ``confirmed`` is False when no legislated schedule exists for the
    jurisdiction.  ``fraction`` is then zero, but the caller must not read that
    as a settled "no mark-up applies".
    """

    fraction: Decimal
    confirmed: bool
    table_version: str
    regulation_ref: str
    jurisdiction: str


# Insert-never-update.  Adding a band means a new MARKUP_TABLE_VERSION.
EU_DEFAULT_VALUE_MARKUP: tuple[MarkupEntry, ...] = (
    MarkupEntry("EU", 2026, 2026, Decimal("0.10"), _EU_REGULATION_REF),
    MarkupEntry("EU", 2027, 2027, Decimal("0.20"), _EU_REGULATION_REF),
    MarkupEntry("EU", 2028, None, Decimal("0.30"), _EU_REGULATION_REF),
)

_SCHEDULES: dict[str, tuple[MarkupEntry, ...]] = {
    "EU": EU_DEFAULT_VALUE_MARKUP,
}

# Jurisdictions the product operates in but which have no legislated schedule.
_UNCONFIRMED: dict[str, str] = {
    "UK": _UK_REGULATION_REF,
}

_TABLE_SHA256: str = hashlib.sha256(
    json.dumps(
        [
            [e.jurisdiction, e.year_from, e.year_to, str(e.fraction)]
            for e in EU_DEFAULT_VALUE_MARKUP
        ],
        sort_keys=True,
    ).encode("utf-8")
).hexdigest()

MARKUP_METADATA = {
    "table_version": MARKUP_TABLE_VERSION,
    "regulation": _EU_REGULATION_REF,
    "applies_to": "default emissions method only",
    "schedule": "10% (2026), 20% (2027), 30% (2028 onward)",
    "table_sha256": _TABLE_SHA256,
}


def get_default_value_markup(
    year: int | None,
    jurisdiction: str = "EU",
) -> MarkupResult:
    """Return the default-value mark-up for a reporting year and jurisdiction.

    A year before the definitive regime carries a confirmed zero mark-up.  A
    jurisdiction with no legislated schedule carries an unconfirmed zero.
    """
    juris = (jurisdiction or "EU").strip().upper()
    schedule = _SCHEDULES.get(juris)

    if schedule is None:
        return MarkupResult(
            fraction=_ZERO,
            confirmed=False,
            table_version=MARKUP_TABLE_VERSION,
            regulation_ref=_UNCONFIRMED.get(juris, "No mark-up schedule held"),
            jurisdiction=juris,
        )

    if year is not None:
        for entry in schedule:
            if entry.covers(year):
                return MarkupResult(
                    fraction=entry.fraction,
                    confirmed=True,
                    table_version=MARKUP_TABLE_VERSION,
                    regulation_ref=entry.regulation_ref,
                    jurisdiction=juris,
                )

    # Before the first band — the definitive regime had not started, so a zero
    # mark-up here is a legislated fact, not an unknown.
    return MarkupResult(
        fraction=_ZERO,
        confirmed=True,
        table_version=MARKUP_TABLE_VERSION,
        regulation_ref=_EU_REGULATION_REF,
        jurisdiction=juris,
    )


def apply_default_value_markup(
    value: Decimal,
    year: int | None,
    emissions_method: str,
    jurisdiction: str = "EU",
) -> Decimal:
    """Apply the mark-up to *value* when the default method was selected.

    Returns *value* unchanged for the actual and estimated methods, for an
    unknown year, and for any jurisdiction with no confirmed schedule.
    """
    if emissions_method != "default" or year is None:
        return value

    markup = get_default_value_markup(year, jurisdiction)
    if not markup.confirmed or markup.fraction == _ZERO:
        return value

    return (Decimal(value) * (Decimal("1") + markup.fraction)).quantize(Decimal("0.001"))
