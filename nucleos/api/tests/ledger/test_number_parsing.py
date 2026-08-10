"""Quantities parse correctly whichever separator convention the document uses.

RISKS.md N6. The live extraction path read "Net mass: 24,500.00 kg" as 24.0 —
one regex stopped at the thousand separator — while the shared parser stripped
every comma, turning the European "24,5" into 245. A thousand-fold error one way
and a ten-fold error the other, both silent: 24 kg of steel is a plausible
quantity, so no downstream check fires and the emissions figure is wrong in
proportion.

Commercial invoices and customs declarations use both conventions, often in the
same corpus, so neither can simply be preferred.

The rule: the rightmost separator that could be a decimal point is the decimal
point. A lone separator followed by exactly three digits is the one genuinely
ambiguous case — "24,500" is 24500 in the UK and 24.5 in Germany. It is read as
a thousands separator, which is the dominant convention on trade documents, and
reported as ambiguous so a reviewer can be told rather than left guessing.
"""
from __future__ import annotations

import pytest

from ledger_app.services.cbam_extraction._validators import (
    _parse_number,
    parse_quantity,
)

pytestmark = pytest.mark.regulatory


class TestUnambiguous:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("24500", 24500.0),
            ("24500.00", 24500.0),
            ("24,500.00", 24500.0),   # UK/US: comma thousands, dot decimal
            ("24.500,00", 24500.0),   # EU: dot thousands, comma decimal
            ("1,234,567", 1234567.0),
            ("1.234.567", 1234567.0),
            ("24 500", 24500.0),      # space as thousands separator
            ("24 500", 24500.0),  # non-breaking space, common in PDFs
            ("0.5", 0.5),
            ("24.5", 24.5),
            ("24,5", 24.5),           # lone comma, 1 decimal digit → decimal comma
            ("24,55", 24.55),         # lone comma, 2 decimal digits → decimal comma
            ("1,2345", 1.2345),       # lone comma, 4 digits → not a thousands group
        ],
    )
    def test_parses(self, text, expected):
        value, _ = parse_quantity(text)
        assert value == pytest.approx(expected)

    @pytest.mark.parametrize("text", [None, "", "   ", "abc", "-", ","])
    def test_unparseable_is_none(self, text):
        value, ambiguous = parse_quantity(text)
        assert value is None
        assert ambiguous is False


class TestTheAmbiguousCase:
    def test_lone_separator_with_three_digits_reads_as_thousands(self):
        value, ambiguous = parse_quantity("24,500")
        assert value == 24500.0
        assert ambiguous is True

    def test_and_the_same_for_a_dot(self):
        value, ambiguous = parse_quantity("24.500")
        assert value == 24500.0
        assert ambiguous is True

    def test_unambiguous_input_is_not_flagged(self):
        assert parse_quantity("24,500.00")[1] is False
        assert parse_quantity("24500")[1] is False
        assert parse_quantity("24,5")[1] is False

    def test_multiple_groups_are_not_ambiguous(self):
        # 1,234,567 can only be thousands — a decimal point cannot repeat.
        assert parse_quantity("1,234,567") == (1234567.0, False)


class TestSharedParserKeepsItsSignature:
    """_parse_number has callers that expect a float or None."""

    def test_returns_the_value(self):
        assert _parse_number("24,500.00") == 24500.0

    def test_no_longer_mangles_a_decimal_comma(self):
        # Was 245.0 — every comma was stripped unconditionally.
        assert _parse_number("24,5") == 24.5

    def test_none_passes_through(self):
        assert _parse_number(None) is None


class TestLiveExtractionPath:
    """The defect as it actually presented, end to end."""

    @pytest.mark.parametrize(
        "mass_text,expected",
        [
            ("24500 kg", 24500.0),
            ("24,500 kg", 24500.0),
            ("24,500.00 kg", 24500.0),
            ("24 500 kg", 24500.0),
            ("24500.00 kg", 24500.0),
        ],
    )
    def test_net_mass_survives_every_separator(self, mass_text, expected):
        from ledger_app.services import text_ingest as ti

        original = ti._specialist_candidates
        ti._specialist_candidates = lambda t: ([], None, [], [], False)
        try:
            result = ti.run_text_ingest(
                f"COMMERCIAL INVOICE\nCN code: 72071111\nNet mass: {mass_text}\n"
            )
        finally:
            ti._specialist_candidates = original

        line = (result["candidate"].get("lines") or [{}])[0]
        assert line.get("net_mass_kg") == pytest.approx(expected)
