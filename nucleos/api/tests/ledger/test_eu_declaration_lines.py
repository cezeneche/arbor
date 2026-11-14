"""The goods lines the EU declaration is built from (POST /cases/{id}/eu-xml).

Found 14 November 2026: the route copied each line's figures under
``direct_kgco2e`` / ``indirect_kgco2e``, which the builder does not read, so
every line of every EU declaration reported zero emissions. And a line whose
recorded figure is the published default carried the raw Annex VI value, so
the declaration left out the legislated mark-up the calculation applies.
"""
from __future__ import annotations

import os
import re
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

from app.services.eu_xml_builder import build_xml_for_case
from ledger_app.api.cbam.report import eu_declaration_lines

CASE = {"importer_eori": "GB123456789000", "reporting_year": 2026, "reporting_quarter": 3, "jurisdiction": "EU"}


def _payload(method: str, direct_kg: float, indirect_kg: float) -> list[dict]:
    # The shape _build_case_shipments_payload returns: the stored row's own
    # column names plus the canonical *_embedded_* copies it adds.
    return [
        {
            "shipment": {"origin_country": "TR"},
            "goods_lines": [
                {
                    "goods_line": {"id": "gl-1", "cn_code": "72083900", "net_mass_kg": 24500},
                    "latest_emissions": {
                        "method": method,
                        "direct_kgco2e": direct_kg,
                        "indirect_kgco2e": indirect_kg,
                        "direct_embedded_kgco2e": direct_kg,
                        "indirect_embedded_kgco2e": indirect_kg,
                        "factor_table_version": "2023",
                        "production_route": None,
                    },
                }
            ],
        }
    ]


def _xml_values(xml: str, tag: str) -> list[Decimal]:
    return [Decimal(v) for v in re.findall(rf"<cbam:{tag}>([^<]*)<", xml)]


def test_a_supplier_figure_reaches_the_declaration():
    # Expected: 360 t direct, 52 t indirect, as recorded. Reason: the route
    # dropped them, and the declaration said zero.
    lines = eu_declaration_lines(_payload("actual", 360000, 52000), reporting_year=2026)
    xml = build_xml_for_case(CASE, lines)

    assert _xml_values(xml, "directEmissions") == [Decimal("360.000000")]
    assert _xml_values(xml, "indirectEmissions") == [Decimal("52.000000")]
    assert _xml_values(xml, "totalEmbeddedEmissions") == [Decimal("360.000000")]


def test_a_recorded_default_carries_the_eu_mark_up():
    # EU 2023/1773 Annex VI default for 24.5 t of 72083900 is 49.245 t direct,
    # 6.615 t indirect; Regulation (EU) 2023/956 Art. 7(2) and Annex IV mark it
    # up by 10% in 2026 (cbam_default_markup, table 2026-eu-v1). Expected:
    # 54.1695 t and 7.2765 t, the figures the calculation shows for an EU case.
    lines = eu_declaration_lines(_payload("default", 49245, 6615), reporting_year=2026)
    xml = build_xml_for_case(CASE, lines)

    assert _xml_values(xml, "directEmissions") == [Decimal("54.169500")]
    assert _xml_values(xml, "indirectEmissions") == [Decimal("7.276500")]
    assert "<cbam:calculationMethod>DEFAULT</cbam:calculationMethod>" in xml


def test_the_mark_up_follows_the_reporting_year():
    # Expected: 20% in 2027 (same schedule). Reason: it is set by year, and a
    # 2027 declaration filed with 2026's rate would understate it.
    lines = eu_declaration_lines(_payload("default", 49245, 6615), reporting_year=2027)
    assert Decimal(str(lines[0]["direct_embedded_kgco2e"])) == Decimal("59094.000")


def test_a_supplier_figure_is_never_marked_up():
    lines = eu_declaration_lines(_payload("actual", 49245, 6615), reporting_year=2026)
    assert Decimal(str(lines[0]["direct_embedded_kgco2e"])) == Decimal("49245")


def test_each_line_keeps_its_origin_and_method():
    (line,) = eu_declaration_lines(_payload("estimated", 1000, 0), reporting_year=2026)
    assert line["origin_country"] == "TR"
    assert line["method"] == "estimated"
    assert line["cn_code"] == "72083900"
