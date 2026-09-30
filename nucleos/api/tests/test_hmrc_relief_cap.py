"""Carbon price relief on the HMRC return never exceeds the charge it offsets.

Finance (No.2) Bill 2025-26, CPR: relief cannot exceed the CBAM charge for the
goods line it relates to. Relief used to be pooled by consignment and the
return's total relief was the uncapped pool, so relief claimed on one line
could wipe out the charge on another line — or on another consignment
altogether. Relief is now taken per goods line and capped at that line's
charge; the total is the sum of what was actually allowed.
"""
from __future__ import annotations

import copy
from decimal import Decimal

from app.services.hmrc_return_builder import build_hmrc_return
from api.tests.test_full_pipeline import _make_hmrc_input, _make_report_package

RATE = Decimal("50.00")


def _two_lines_one_consignment() -> dict:
    pkg = _make_report_package(direct_kgco2e=100_000, goods_line_id="GL-A")
    second = copy.deepcopy(pkg["shipments"][0]["goods_lines"][0])
    second["goods_line"]["id"] = "GL-B"
    second["latest_emissions"]["goods_line_id"] = "GL-B"
    pkg["shipments"][0]["goods_lines"].append(second)
    return pkg


def test_relief_on_one_line_is_capped_at_that_lines_charge():
    doc = build_hmrc_return(
        _two_lines_one_consignment(),
        _make_hmrc_input(cbam_rate=RATE, cpr_by_goods_line={"GL-A": Decimal("999999")}),
    )
    a, b = doc.consignments[0].goods_lines
    # Each line: 100 tCO2e x £50 = £5,000.
    assert (a.cbam_charge_gbp, a.cpr_gbp, a.cbam_liability_gbp) == (Decimal("5000.00"), Decimal("5000.00"), Decimal("0.00"))
    assert (b.cbam_charge_gbp, b.cpr_gbp, b.cbam_liability_gbp) == (Decimal("5000.00"), Decimal("0.00"), Decimal("5000.00"))
    assert doc.total_cpr_gbp == Decimal("5000.00")
    assert doc.total_cbam_liability_gbp == Decimal("5000.00")


def test_relief_under_the_charge_is_taken_in_full():
    doc = build_hmrc_return(
        _two_lines_one_consignment(),
        _make_hmrc_input(cbam_rate=RATE, cpr_by_goods_line={"GL-A": Decimal("1200.50")}),
    )
    a, b = doc.consignments[0].goods_lines
    assert a.cpr_gbp == Decimal("1200.50")
    assert b.cpr_gbp == Decimal("0.00")
    assert doc.total_cbam_liability_gbp == Decimal("8799.50")


def test_consignment_relief_cannot_offset_another_consignment():
    pkg = _make_report_package(direct_kgco2e=100_000, entry_reference="REF-1", goods_line_id="GL-1")
    other = copy.deepcopy(pkg["shipments"][0])
    other["shipment"]["id"] = "SHIP-2"
    other["shipment"]["entry_reference"] = "REF-2"
    other["goods_lines"][0]["goods_line"]["id"] = "GL-2"
    pkg["shipments"].append(other)

    doc = build_hmrc_return(pkg, _make_hmrc_input(cbam_rate=RATE, cpr_by_consignment={"REF-1": Decimal("999999")}))
    # REF-1's relief is capped at REF-1's £5,000; REF-2 still owes its £5,000.
    assert doc.total_cpr_gbp == Decimal("5000.00")
    assert doc.total_cbam_liability_gbp == Decimal("5000.00")
