"""Reading a declared mass into kilograms.

net_mass_kg is kilograms by its name, and the unit beside the number was never
read: "Net mass 24.5 t" was stored as 24.5 kg. A declaration in tonnes — which
is how steel is usually declared — was understated a thousandfold, and that
figure goes straight into embedded emissions and the CBAM charge.

A mass whose unit is not understood is dropped rather than assumed, because a
missing mass is visible to a reviewer and a wrong one is not.
"""

from __future__ import annotations

import pytest

from ledger_app.services.cbam_extraction._validators import mass_in_kg


@pytest.mark.parametrize(
    ("number", "unit", "expected"),
    [
        ("24500", "kg", 24500),
        ("24500", "KG", 24500),
        ("24500", "kgs", 24500),
        ("24500", "kilograms", 24500),
        ("24.5", "t", 24500),
        ("24.5", "T", 24500),
        ("24.5", "tonne", 24500),
        ("24.5", "tonnes", 24500),
        ("24.5", "mt", 24500),
        ("24.5", "metric tonnes", 24500),
        ("24,500.00", "kg", 24500),
        ("24.500,00", "kg", 24500),
    ],
)
def test_a_mass_is_read_in_the_unit_the_document_used(number, unit, expected):
    value, _ = mass_in_kg(number, unit)
    assert value == pytest.approx(expected)


def test_no_unit_means_kilograms():
    # Customs Box 38 is kilograms and the field is named for them, so a bare
    # number on a declaration is kilograms.
    assert mass_in_kg("24500", None)[0] == pytest.approx(24500)


@pytest.mark.parametrize("unit", ["boxes", "coils", "pallets", "units", "pcs"])
def test_a_unit_that_is_not_a_mass_is_refused(unit):
    assert mass_in_kg("14", unit)[0] is None


def test_a_negative_mass_is_refused():
    # Goods cannot weigh less than nothing; the sign is a misread, not a value.
    assert mass_in_kg("-24500", "kg")[0] is None


def test_an_ambiguous_separator_is_still_reported():
    # "24,500" is 24500 here and 24.5 in Germany. The flag survives conversion.
    _, ambiguous = mass_in_kg("24,500", "kg")
    assert ambiguous is True


def test_a_mass_of_nothing_is_refused():
    # Goods that weigh nothing are not goods. A zero reaches the charge as zero
    # embedded emissions, which is a misread presented as a fact.
    assert mass_in_kg("0", "kg")[0] is None


@pytest.mark.parametrize(
    ("number", "unit"),
    [
        ("999999999999999", "kg"),   # a thousand million tonnes
        ("2000000", "t"),            # two million tonnes in one consignment
    ],
)
def test_a_mass_beyond_any_consignment_is_refused(number, unit):
    # The largest bulk carrier afloat moves about 400,000 tonnes. A figure past
    # that is digits run together, and it would carry a liability to match.
    assert mass_in_kg(number, unit)[0] is None


def test_a_large_but_possible_consignment_is_kept():
    # A full Capesize cargo. The ceiling must not refuse real trade.
    assert mass_in_kg("180000", "t")[0] == pytest.approx(180_000_000)
