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


# A declaration commonly covers several commodity codes. Only the first was ever
# read, so the case understated the import — quietly, because what it did
# produce looked complete.
MULTI_ITEM = """IMPORT DECLARATION
Declaration reference (MRN)
26GB52TESTDOC04177
Importer EORI
GB247188003000
Country of origin
TR - Turkiye

Item 1
Commodity code (CN) 7208 3900
Goods description Hot-rolled coil, grade S235JR
Net mass 24 500 kg

Item 2
Commodity code (CN) 7213 1000
Goods description Hot-rolled bar, ribbed, 12 mm
Net mass 8 200 kg

Item 3
Commodity code (CN) 7601 1000
Goods description Unwrought aluminium, not alloyed
Net mass 3 040 kg

Total net mass 35 740 kg
"""


@pytest.fixture(scope="module")
def multi() -> dict:
    return parse_customs_declaration(MULTI_ITEM)


def test_every_goods_item_becomes_a_line(multi):
    assert [line["cn_code"] for line in multi["lines"]] == ["72083900", "72131000", "76011000"]


def test_each_line_keeps_its_own_mass(multi):
    # The masses must not be smeared from the first item, and the total at the
    # foot of the page is not a fourth item.
    assert [line["net_mass_kg"] for line in multi["lines"]] == [24500, 8200, 3040]


def test_each_line_keeps_its_own_description(multi):
    assert multi["lines"][1]["description"] == "Hot-rolled bar, ribbed, 12 mm"


def test_a_single_item_declaration_still_yields_one_line(parsed):
    assert len(parsed["lines"]) == 1


# Shape validation, the general guard.
#
# Every bug above was the same shape of mistake: a pattern matched something
# that was not the value — a label, a fragment, a neighbouring figure — and the
# parser returned it because nothing checked that what came back could be the
# thing it claimed. The patterns are now correct for the layouts we have seen,
# but the next unseen layout will find another way through. These cases fix the
# behaviour when it does: the value is dropped, so the field reads as missing
# and a reviewer is asked. A missing field is visible; a wrong one is not.
@pytest.mark.parametrize(
    "text",
    [
        "Commodity code (CN)\nPending classification",   # no digits at all
        "Commodity code (CN)\n7208",                     # too few digits for a CN code
        "Commodity code (CN)\n720 839",                  # six digits: an HS code, not CN
    ],
)
def test_a_value_that_cannot_be_a_cn_code_is_not_returned_as_one(text):
    assert parse_customs_declaration(text)["lines"] == []


@pytest.mark.parametrize(
    "printed",
    [
        "Importer EORI\nnot supplied",
        "Importer / Declarant\nAcme Steel Ltd",  # a name, not an identifier
        "Consignee\nGB",                         # a country on its own
    ],
)
def test_a_value_that_cannot_be_an_eori_is_not_returned_as_one(printed):
    assert parse_customs_declaration(printed)["importer"]["eori"] == ""


@pytest.mark.parametrize(
    "printed",
    [
        "Movement reference number: NOT YET ISSUED",
        "MRN: 24GB98",  # too short to be an MRN
    ],
)
def test_a_value_that_cannot_be_an_mrn_is_not_returned_as_one(printed):
    assert parse_customs_declaration(printed)["invoice"]["entry_reference"] is None


@pytest.mark.parametrize(
    "label",
    ["value", "amount", "date", "number", "reference", "description", "code", "total", "declarant"],
)
def test_no_field_is_ever_filled_with_a_bare_label_word(label):
    # Whatever the pattern does, a label word is not a value. This is the
    # backstop for layouts nobody has written a case for.
    text = f"IMPORT DECLARATION\nImporter EORI\n{label}\nInvoice\n{label}\nCommodity code\n{label}\n"
    parsed = parse_customs_declaration(text)
    assert parsed["importer"]["eori"] == ""
    assert parsed["invoice"]["invoice_number"] is None
    assert parsed["lines"] == []


# A VAT number and an EORI both start with the country code, and declarations
# print them next to each other. Reading the VAT number as the EORI files the
# entry against an identifier the importer does not trade under.
def test_a_vat_number_is_not_read_as_an_eori_when_both_are_printed():
    text = "IMPORT DECLARATION\nImporter VAT\nGB 247 1880 03\nImporter EORI\nGB247188003000\n"
    assert parse_customs_declaration(text)["importer"]["eori"] == "GB247188003000"


def test_a_vat_number_alone_does_not_become_an_eori():
    text = "IMPORT DECLARATION\nImporter VAT\nGB 247 1880 03\n"
    assert parse_customs_declaration(text)["importer"]["eori"] == ""


# Layouts other than the CDS entry summary. Each was found by running an
# unfamiliar form through the parser rather than by reasoning about the
# patterns, which is how the first three bugs reached production.
C88_BOXES = """SINGLE ADMINISTRATIVE DOCUMENT (C88)
Box 8 Consignee  GB247188003000  Acme Steel Ltd
Box 33 Commodity Code  7208 39 00
Box 34 Country of origin code  TR
Box 35 Gross mass (kg)  24 780
Box 38 Net mass (kg)  24 500
Box 37 Procedure  4000
Box 7 Declaration reference  26GB52TESTDOC04177
"""

TABULAR = """Item  CN Code     Description                  Net mass (kg)
1     72083900    Hot-rolled coil S235JR       24,500.00
2     72131000    Hot-rolled bar 12mm           8,200.00
Importer EORI GB247188003000   Origin: TR
"""


def test_an_identifier_stops_at_the_name_printed_after_it():
    # "Box 8 Consignee GB247188003000 Acme Steel Ltd" — a tail that admits
    # letters swallowed the company name, giving GB247188003000ACM.
    assert parse_customs_declaration(C88_BOXES)["importer"]["eori"] == "GB247188003000"


def test_a_box_numbered_form_reads_like_any_other():
    parsed = parse_customs_declaration(C88_BOXES)
    assert parsed["invoice"]["origin_country"] == "TR"
    assert parsed["lines"][0]["cn_code"] == "72083900"
    assert parsed["lines"][0]["net_mass_kg"] == 24500  # Box 38, not the gross mass


def test_a_column_layout_yields_one_line_per_row():
    parsed = parse_customs_declaration(TABULAR)
    assert [(line["cn_code"], line["net_mass_kg"]) for line in parsed["lines"]] == [
        ("72083900", 24500),
        ("72131000", 8200),
    ]


def test_a_column_layout_still_reads_the_shipment_fields():
    parsed = parse_customs_declaration(TABULAR)
    assert parsed["importer"]["eori"] == "GB247188003000"
    assert parsed["invoice"]["origin_country"] == "TR"


# Every value must carry the text it was read from.
#
# A reviewer confirms a value against its source text, and Arbor cannot certify
# a record Verified without it. The parser recorded values with snippet=None, so
# everything it found arrived unconfirmable: the review screen showed the value
# and, beside it, "no source text came with this value".
def _atoms(parsed: dict, field: str) -> list[dict]:
    return [e for e in parsed["evidence"] if e["field"] == field]


@pytest.mark.parametrize(
    "field",
    ["importer.eori", "invoice.origin_country", "invoice.entry_reference",
     "invoice.invoice_number", "lines[0].cn_code", "lines[0].net_mass_kg"],
)
def test_every_value_carries_the_text_it_was_read_from(parsed, field):
    atoms = _atoms(parsed, field)
    assert atoms, f"no evidence recorded for {field}"
    assert atoms[0]["snippet"], f"{field} has no source text"


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("importer.eori", "GB247188003000"),
        ("invoice.entry_reference", "26GB52TESTDOC04177"),
        ("lines[0].cn_code", "7208 3900"),
    ],
)
def test_the_snippet_contains_the_value_as_the_document_prints_it(parsed, field, expected):
    # The snippet is what a reviewer reads to decide. It has to show the value
    # in its own words — spaced as the form spaces it — not the cleaned version.
    assert expected in _atoms(parsed, field)[0]["snippet"]


def test_a_span_locates_the_value_in_the_document(parsed):
    span = _atoms(parsed, "importer.eori")[0]["span"]
    assert span and span["end"] > span["start"]
    assert CDS_ENTRY[span["start"]:span["end"]].strip() == "GB247188003000"


def test_each_goods_line_points_at_its_own_text(multi):
    first = [e for e in multi["evidence"] if e["field"] == "lines[0].cn_code"][0]
    second = [e for e in multi["evidence"] if e["field"] == "lines[1].cn_code"][0]
    assert "7208 3900" in first["snippet"]
    assert "7213 1000" in second["snippet"]


# The unit beside the mass. "Net mass 24.5 t" was read as 24.5 kg, which
# understates a steel import by a thousand times on the one figure the CBAM
# charge is computed from.
@pytest.mark.parametrize(
    ("printed", "expected_kg"),
    [
        ("Commodity code 72083900\nNet mass 24 500 kg", 24500),
        ("Commodity code 72083900\nNet mass 24.5 t", 24500),
        ("Commodity code 72083900\nNet mass 24.5 tonnes", 24500),
        ("Commodity code 72083900\nNet mass (kg) 24 500", 24500),
        ("Commodity code 72083900\nNet mass 24.5 MT", 24500),
    ],
)
def test_a_mass_is_converted_from_the_unit_the_document_states(printed, expected_kg):
    assert parse_customs_declaration(printed)["lines"][0]["net_mass_kg"] == pytest.approx(expected_kg)


def test_a_mass_in_a_unit_that_is_not_a_mass_is_not_recorded():
    parsed = parse_customs_declaration("Commodity code 72083900\nNet mass 14 pallets")
    assert parsed["lines"][0]["net_mass_kg"] is None


def test_the_tonnage_on_the_line_follows_the_converted_mass():
    line = parse_customs_declaration("Commodity code 72083900\nNet mass 24.5 t")["lines"][0]
    assert line["quantity"] == pytest.approx(24.5)  # tonnes
    assert line["net_mass_kg"] == pytest.approx(24500)
