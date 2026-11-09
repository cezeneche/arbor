"""The UK return states the quarter each consignment was imported in.

The Carbon Border Adjustment Mechanism (Administrative Provisions and
Determination of Carbon Price Relief) Force of Law Notice (draft, 13 July 2026),
on regulation 10(3): "For the first CBAM return covering the 1 January 2027 to
31 December 2027 accounting period, the return must state the quarter in which
the relevant CBAM good was imported."

The return carried each consignment's import date but never the quarter. The
quarter is the calendar quarter of the import date, stated on every consignment
in the JSON and beside the import date in the PDF. An unreadable import date
used to become the period's first day, which on the 2027 return would state
"Q1" for goods that may have arrived in any quarter, so the quarter is left
unstated and a warning says why.
"""

from __future__ import annotations

import json

from app.services.hmrc_return_builder import build_hmrc_return, return_to_json, return_to_pdf
from api.tests.test_full_pipeline import _make_hmrc_input, _make_report_package


def _return_importing_on(import_date):
    pkg = _make_report_package(reporting_year=2027)
    pkg["shipments"][0]["shipment"]["import_date"] = import_date
    return build_hmrc_return(pkg, _make_hmrc_input())


def test_each_consignment_states_its_import_quarter():
    for import_date, quarter in (
        ("2027-01-01", 1), ("2027-03-31", 1), ("2027-04-01", 2),
        ("2027-08-15", 3), ("2027-10-01", 4), ("2027-12-31", 4),
    ):
        doc = _return_importing_on(import_date)
        assert doc.consignments[0].import_quarter == quarter, import_date


def test_the_quarter_is_in_the_json():
    doc = _return_importing_on("2027-08-15")
    consignment = json.loads(return_to_json(doc))["consignments"][0]
    assert consignment["import_date"] == "2027-08-15"
    assert consignment["import_quarter"] == 3


def test_the_quarter_is_beside_the_import_date_in_the_pdf():
    import io

    from pypdf import PdfReader

    pdf = return_to_pdf(_return_importing_on("2027-08-15"))
    text = "".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)
    assert "15/08/2027" in text
    assert "Q3 2027" in text


def test_an_unreadable_import_date_does_not_become_a_quarter():
    doc = _return_importing_on("not a date")
    assert doc.consignments[0].import_quarter is None
    assert any(w.startswith("consignment_import_quarter_unknown:") for w in doc.warnings)


def test_a_quarterly_return_states_it_too():
    pkg = _make_report_package(reporting_year=2028, reporting_quarter=2)
    pkg["shipments"][0]["shipment"]["import_date"] = "2028-05-20"
    doc = build_hmrc_return(pkg, _make_hmrc_input())
    assert doc.consignments[0].import_quarter == 2
