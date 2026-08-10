"""All four parsers are wired in behind the single text-in entry point.

They had zero call sites before Phase 2. Their behaviour is frozen in the golden
set, which is what made wiring them in safe to do deliberately.

How they attach differs, and the difference is not cosmetic:

  * Customs, spreadsheet and XML produce the full extractor shape, so they enter
    as additional ARBITER CANDIDATES. The arbiter already exists to resolve
    disagreement between candidates; routing them anywhere else would mean
    reimplementing it.
  * The mill certificate produces a supplementary dict with no invoice or goods
    lines — its own docstring says to merge it rather than treat it as a parse.
    It attaches alongside the candidate, never as one.
"""
from __future__ import annotations

import pytest

from ledger_app.services.text_ingest import run_text_ingest

pytestmark = pytest.mark.regulatory

CUSTOMS = """SINGLE ADMINISTRATIVE DOCUMENT (C88)
Box 7  MRN: 24GB12345678901234
Box 8  Consignee EORI: GB123456789000
Box 33 Commodity code: 72071111
Box 34 Country of origin: TR
Box 35 Net mass: 24,500.00 kg
Box 37 Procedure: 4000
"""

MILL_CERT = """INSPECTION CERTIFICATE EN 10204 3.1
Heat number: A4471928
Grade: S355J2
CHEMICAL COMPOSITION (%)
C : 0.18
Mn : 1.45
P : 0.022
S : 0.019
"""

SPREADSHEET = (
    "CN Code,Country of Origin,Nett Weight (kg),Calculation Method,Direct Embedded kgCO2e\n"
    "72071111,TR,24500,actual,44100\n"
)

XML_DECLARATION = """<?xml version="1.0" encoding="UTF-8"?>
<cbam:quarterlyDeclaration xmlns:cbam="urn:ec.europa.eu:taxud:cbam:declaration:v1">
  <cbam:declarant><cbam:eori>DE123456789012345</cbam:eori></cbam:declarant>
  <cbam:goodsImported>
    <cbam:goodsLine>
      <cbam:cnCode>72071111</cbam:cnCode>
      <cbam:countryOfOrigin>TR</cbam:countryOfOrigin>
      <cbam:netMassTonnes>24.500</cbam:netMassTonnes>
      <cbam:embeddedEmissions>
        <cbam:directEmissions>44.100</cbam:directEmissions>
        <cbam:calculationMethod>ACTUAL</cbam:calculationMethod>
      </cbam:embeddedEmissions>
    </cbam:goodsLine>
  </cbam:goodsImported>
</cbam:quarterlyDeclaration>
"""

PLAIN_INVOICE = """COMMERCIAL INVOICE
Invoice number: INV-2027-0042
CN code: 72071111
Net mass: 24500 kg
"""


class TestRouting:
    def test_customs_declaration_is_detected_and_used(self):
        result = run_text_ingest(CUSTOMS)
        assert "customs_parser" in result["parsers_applied"]
        # Fields the customs parser genuinely contributes.
        assert result["candidate"]["invoice"]["origin_country"] == "TR"
        assert result["candidate"]["importer"]["eori"] == "GB123456789000"

    def test_customs_extracts_the_mrn(self):
        """RISKS.md N7, fixed: _MRN_RE demanded 20 characters where a real
        Movement Reference Number is 18, so none ever matched."""
        result = run_text_ingest(CUSTOMS)
        assert result["candidate"]["invoice"]["entry_reference"] == "24GB12345678901234"

    def test_customs_extracts_the_net_mass_with_separators(self):
        """RISKS.md N7, fixed: the capture class admitted whitespace alone, so
        'Box 35 Net mass: 24,500.00 kg' matched a bare space as the value."""
        result = run_text_ingest(CUSTOMS)
        line = (result["candidate"].get("lines") or [{}])[0]
        assert line.get("net_mass_kg") == 24500.0

    def test_xml_declaration_is_detected_and_used(self):
        result = run_text_ingest(XML_DECLARATION)
        assert "xml_declaration_parser" in result["parsers_applied"]
        line = result["candidate"]["lines"][0]
        assert line["cn_code"] == "72071111"
        assert line["net_mass_kg"] == 24500.0

    def test_spreadsheet_is_detected_and_used(self):
        result = run_text_ingest(SPREADSHEET)
        assert "spreadsheet_parser" in result["parsers_applied"]
        assert result["candidate"]["lines"][0]["cn_code"] == "72071111"

    def test_mill_certificate_attaches_as_supplementary_not_as_a_candidate(self):
        result = run_text_ingest(MILL_CERT)
        assert "mill_cert_parser" in result["parsers_applied"]
        supp = result["supplementary"]
        # RISKS.md N8, fixed: the alternation listed "heat" before "heat no.",
        # so the longer branches were unreachable and the capture took the
        # following word.
        assert supp["heat_number"] == "A4471928"
        assert supp["grade"] == "S355J2"
        # A supplementary dict has no goods lines; it must not have become the
        # candidate, or the invoice fields would have been wiped out by it.
        assert "invoice" in result["candidate"]

    def test_a_plain_invoice_uses_no_specialist_parser(self):
        result = run_text_ingest(PLAIN_INVOICE)
        assert result["parsers_applied"] == []
        assert result["candidate"]["lines"][0]["cn_code"] == "72071111"

    def test_supplementary_is_absent_when_no_certificate_was_seen(self):
        assert run_text_ingest(PLAIN_INVOICE)["supplementary"] is None


class TestParserFailuresDoNotSinkTheExtraction:
    def test_malformed_xml_falls_back_to_the_regex_candidate(self):
        """A parser that raises must not take the whole extraction with it —
        the deterministic layer still has a usable answer."""
        broken = "<?xml version='1.0'?><cbam:quarterlyDeclaration><unclosed>"
        result = run_text_ingest(broken + "\nCN code: 72071111\nNet mass: 100 kg\n")
        assert any(f.startswith("parser_failed:") for f in result["parser_flags"])
        assert result["candidate"] is not None

    def test_parser_failure_is_flagged_verbatim(self):
        broken = "<?xml version='1.0'?><cbam:quarterlyDeclaration><unclosed>"
        result = run_text_ingest(broken)
        assert any("xml_declaration_parser" in f for f in result["parser_flags"])
