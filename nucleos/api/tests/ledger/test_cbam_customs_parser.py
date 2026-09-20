"""Field patterns of the customs declaration parser.

Every case here is a format a real declaration prints. The parser fed a whole
CBAM case from a CDS entry summary and returned the word DECLARANT as an EORI,
the letters ERENCE as an invoice number, and no goods line at all — a label
fragment beats a real value whenever a pattern lacks a word boundary or assumes
an identifier is printed without separators.
"""

from __future__ import annotations

import pytest

from ledger_app.services.cbam_customs_parser import parse_customs_declaration

# A CDS entry summary, in the layout a PDF text layer yields: label line,
# then value line.
CDS_ENTRY = """IMPORT DECLARATION
Customs Declaration Service (CDS) - entry summary
DECLARATION REFERENCE (MRN)
26GB52TESTDOC04177
DECLARATION DATE
04/09/2026
IMPORTER / DECLARANT
Acme Steel Ltd
IMPORTER EORI
GB247188003000
COUNTRY OF ORIGIN
TR - Turkiye
Commodity code (CN)
7208 3900
Goods description
Hot-rolled coil, non-alloy steel, grade S235JR
Net mass
24 500 kg
Supplier invoice
CMS-2026-4417
"""


@pytest.fixture(scope="module")
def parsed() -> dict:
    return parse_customs_declaration(CDS_ENTRY)


def test_eori_is_the_identifier_not_the_word_after_the_label(parsed):
    # "IMPORTER / DECLARANT": the DE of DECLARANT is a country code, so an
    # alternation without a word boundary reads the label as the EORI.
    assert parsed["importer"]["eori"] == "GB247188003000"


def test_invoice_number_is_not_a_fragment_of_the_word_reference(parsed):
    # "DECLARATION REFERENCE" contains "REF"; capturing what follows yields
    # "ERENCE", which looks enough like a reference to pass unnoticed.
    assert parsed["invoice"]["invoice_number"] == "CMS-2026-4417"


@pytest.mark.parametrize(
    "label_line",
    [
        "Invoice value\n18,375.00 GBP",
        "Invoice amount\n18,375.00 GBP",
        "Invoice date\n28/08/2026",
    ],
)
def test_a_neighbouring_label_is_not_read_as_an_invoice_number(label_line):
    # The keyword is followed by another label, not a reference. Taking the next
    # word recorded "VALUE" as the invoice number; taking the next digits would
    # record the money instead.
    text = f"IMPORT DECLARATION\n{label_line}\nSupplier invoice\nCMS-2026-4417\n"
    assert parse_customs_declaration(text)["invoice"]["invoice_number"] == "CMS-2026-4417"


def test_an_invoice_number_must_carry_a_digit():
    text = "IMPORT DECLARATION\nInvoice value\n18,375.00 GBP\n"
    assert parse_customs_declaration(text)["invoice"]["invoice_number"] is None


@pytest.mark.parametrize(
    ("printed", "expected"),
    [
        ("Commodity code (CN)\n7208 3900", "72083900"),
        ("Commodity code: 72083900", "72083900"),
        ("Commodity code 7208 39 00", "72083900"),
        ("Box 33\n7208 3900 00", "72083900"),  # 10-digit TARIC, CN is the first 8
    ],
)
def test_cn_code_is_read_however_the_form_groups_the_digits(printed, expected):
    # Customs forms group CN digits. Requiring eight consecutive digits found
    # nothing, and no CN code means no goods line and no CBAM case.
    assert parse_customs_declaration(printed)["lines"][0]["cn_code"] == expected


def test_a_goods_line_carries_the_code_and_the_mass(parsed):
    assert len(parsed["lines"]) == 1
    line = parsed["lines"][0]
    assert line["cn_code"] == "72083900"
    assert line["net_mass_kg"] == 24500
    assert line["quantity"] == pytest.approx(24.5)


def test_the_rest_of_the_shipment_fields_still_read(parsed):
    assert parsed["invoice"]["entry_reference"] == "26GB52TESTDOC04177"
    assert parsed["invoice"]["origin_country"] == "TR"


def test_evidence_records_what_was_found(parsed):
    found = {e["field"]: e["value"] for e in parsed["evidence"]}
    assert found["importer.eori"] == "GB247188003000"
    assert found["lines[0].cn_code"] == "72083900"


def test_absent_fields_stay_absent_rather_than_guessing():
    # A declaration with none of these must not invent them: an EORI-shaped
    # guess would be recorded against a real importer.
    parsed = parse_customs_declaration("IMPORT DECLARATION\nNo further detail supplied.\n")
    assert parsed["importer"]["eori"] == ""
    assert parsed["invoice"]["invoice_number"] is None
    assert parsed["lines"] == []
