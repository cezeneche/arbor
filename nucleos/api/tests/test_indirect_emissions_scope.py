"""Indirect emissions count only where the regime charges them.

EU Regulation 2023/956, Art. 7(1) and Annex II: for goods listed in Annex II —
iron and steel, aluminium and hydrogen — only direct embedded emissions are
taken into account. Cement and fertilisers count direct and indirect emissions.

UK CBAM (Finance (No.2) Bill 2025-26): direct emissions only, until 2029 at
the earliest.

Indirect emissions are still recorded and reported; they are left out of the
embedded total that the charge or certificates are based on. Both the
calculation and the EU declaration added them for every good.
"""
from __future__ import annotations

import re
from decimal import Decimal

import pytest

from app.services.eu_xml_builder import build_quarterly_declaration
from ledger_app.services.cbam_emissions_selector import select_and_calculate
from ledger_app.services.cbam_indirect_scope import counts_indirect_emissions

pytestmark = pytest.mark.regulatory

STEEL = "72081000"
ALUMINIUM = "76011000"
CEMENT = "25232900"
FERTILISER = "31021000"
HYDROGEN = "28041000"


@pytest.mark.parametrize(
    ("cn_code", "jurisdiction", "counts"),
    [
        (CEMENT, "EU", True),
        (FERTILISER, "EU", True),
        (STEEL, "EU", False),
        (ALUMINIUM, "EU", False),
        (HYDROGEN, "EU", False),
        (CEMENT, "UK", False),
        (STEEL, "UK", False),
        ("99999999", "EU", False),
    ],
)
def test_which_goods_count_indirect_emissions(cn_code, jurisdiction, counts):
    assert counts_indirect_emissions(cn_code, jurisdiction) is counts


def _actual(cn_code: str, jurisdiction: str):
    # 100 t of goods; supplier declares 100 tCO2e direct and 50 tCO2e indirect.
    return select_and_calculate(
        cn_code=cn_code,
        net_mass_kg=Decimal("100000"),
        direct_kgco2e_supplier=Decimal("100000"),
        indirect_kgco2e_supplier=Decimal("50000"),
        supplier_direct_confidence=0.95,
        supplier_indirect_confidence=0.95,
        force_method="actual",
        reporting_year=2027,
        jurisdiction=jurisdiction,
    )


def test_uk_embedded_emissions_are_direct_only():
    result = _actual(STEEL, "UK")
    assert result.embedded_tco2e == Decimal("100")
    assert result.indirect_kgco2e == Decimal("50000")  # still recorded


def test_eu_steel_embedded_emissions_are_direct_only():
    assert _actual(STEEL, "EU").embedded_tco2e == Decimal("100")


def test_eu_cement_embedded_emissions_include_indirect():
    assert _actual(CEMENT, "EU").embedded_tco2e == Decimal("150")


def _line(cn_code: str) -> dict:
    return {
        "cn_code": cn_code,
        "origin_country": "TR",
        "net_mass_kg": 100000,
        "direct_embedded_kgco2e": 100000,
        "indirect_embedded_kgco2e": 50000,
        "see_tco2e_per_t": 1.5,
        "calculation_method": "actual",
    }


def _values(xml: str, tag: str) -> list[Decimal]:
    return [Decimal(v) for v in re.findall(rf"<[^>]*{tag}>([^<]+)<", xml)]


def test_the_eu_declaration_totals_indirect_only_for_cement_and_fertilisers():
    xml = build_quarterly_declaration(
        importer_eori="DE123456789012345",
        reporting_year=2026,
        reporting_quarter=4,
        goods_lines=[_line(STEEL), _line(CEMENT)],
    )
    # Indirect emissions are still reported on every line …
    assert _values(xml, "indirectEmissions") == [Decimal("50"), Decimal("50")]
    # … but only cement's count towards its embedded total.
    assert _values(xml, "totalEmbedded") == [Decimal("100"), Decimal("150")]
    assert _values(xml, "totalEmbeddedEmissions") == [Decimal("250")]
