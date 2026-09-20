"""Labels the parser was not written for: other languages, and OCR damage.

The patterns in cbam_customs_parser are English and exact. A declaration in
German, or an English one scanned badly enough that "Commodity" came back as
"Comrnodity", failed the document-type check outright — so the parser never ran,
and the fields it would have found were never sought.

The fallback here matches a label by how close it is to one we know, then makes
the value prove it can be what the label claims. A near-miss on the label is
recoverable; a value of the wrong shape is not, and is dropped.
"""

from __future__ import annotations

import pytest

from ledger_app.services.cbam_customs_parser import (
    is_customs_declaration,
    parse_customs_declaration,
)

GERMAN = """Zollanmeldung
Warennummer: 7208 39 00
Eigenmasse: 24.500,50 kg
Ursprungsland: TR
EORI-Nummer: DE123456789012
"""

FRENCH = """Declaration en douane
Code marchandise: 7208 39 00
Masse nette: 24 500 kg
Pays d'origine: TR
Numero EORI: FR12345678901
"""

OCR_DAMAGED = """IMPORT DECLARATTON
Comrnodity code (CN)  7208 3900
Net rnass  24 500 kg
lmporter EORI  GB247188003000
Country of origjn  TR
"""


@pytest.mark.parametrize("text", [GERMAN, FRENCH, OCR_DAMAGED])
def test_the_document_is_recognised_as_a_declaration(text):
    # Detection gates the parser: a form that fails this is never read at all.
    assert is_customs_declaration(text)


@pytest.mark.parametrize(
    ("text", "expected_mass"),
    [(GERMAN, 24500.5), (FRENCH, 24500), (OCR_DAMAGED, 24500)],
)
def test_the_goods_line_is_read_whatever_the_label_says(text, expected_mass):
    line = parse_customs_declaration(text)["lines"][0]
    assert line["cn_code"] == "72083900"
    assert line["net_mass_kg"] == pytest.approx(expected_mass)


@pytest.mark.parametrize("text", [GERMAN, FRENCH, OCR_DAMAGED])
def test_the_origin_country_is_read(text):
    assert parse_customs_declaration(text)["invoice"]["origin_country"] == "TR"


@pytest.mark.parametrize(
    ("text", "expected_eori"),
    [(GERMAN, "DE123456789012"), (FRENCH, "FR12345678901"), (OCR_DAMAGED, "GB247188003000")],
)
def test_the_importer_is_read(text, expected_eori):
    assert parse_customs_declaration(text)["importer"]["eori"] == expected_eori


def test_a_value_of_the_wrong_shape_is_still_dropped():
    # Tolerance applies to the label, never to the value. "Eigenmasse: pending"
    # is a label we now understand carrying nothing we can use.
    text = "Zollanmeldung\nWarennummer: ausstehend\nEigenmasse: keine Angabe\nUrsprungsland: Turkei\n"
    parsed = parse_customs_declaration(text)
    assert parsed["lines"] == []
    assert parsed["invoice"]["origin_country"] is None


def test_an_unrelated_document_is_not_dragged_in_by_a_loose_match():
    # The tolerance must not make every invoice look like a declaration.
    text = "COMMERCIAL INVOICE\nInvoice number: INV-2026-88\nAmount due: 18,375.00 GBP\nTerms: 30 days\n"
    assert not is_customs_declaration(text)


# Matching labels by closeness buys tolerance at the cost of precision. These
# are the documents that share vocabulary with a declaration — weights,
# consignees, references — and must still not be read as one, or a freight
# invoice becomes a CBAM case.
@pytest.mark.parametrize(
    ("kind", "text"),
    [
        ("commercial invoice",
         "COMMERCIAL INVOICE\nInvoice number: INV-2026-88\nAmount due 18,375.00 GBP\nTerms 30 days\n"),
        ("mill certificate",
         "INSPECTION CERTIFICATE EN 10204 3.1\nHeat number 7741\nGrade S235JR\nTensile strength 430 MPa\n"),
        ("electricity bill",
         "ELECTRICITY BILL\nMPAN 1200023456789\nTotal consumption 42,500 kWh\nPeriod 01/07/2026 to 30/09/2026\n"),
        ("delivery note",
         "DELIVERY NOTE\nDelivery note reference DN-8871\nConsignee Acme Steel Ltd\nItems 14 coils\n"),
        ("freight invoice",
         "FREIGHT INVOICE\nCarrier Maersk\nOrigin Izmir\nDestination Immingham\nShipment weight 24 780 kg\n"),
    ],
)
def test_another_document_type_is_not_read_as_a_declaration(kind, text):
    assert not is_customs_declaration(text), kind
