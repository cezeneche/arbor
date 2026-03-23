"""Tests for cbam_xml_exporter.py — EU Registry quarterly declaration XML."""

from __future__ import annotations

from decimal import Decimal
from xml.etree import ElementTree as ET

import pytest

from ledger_app.services.cbam_xml_exporter import (
    _CBAM_NS,
    _tag,
    build_quarterly_declaration,
    declaration_from_reconciliation,
    validate_xml_structure,
)
from ledger_app.services.cbam_reconciler import reconcile_quarter

_D = Decimal

# ── Fixtures ───────────────────────────────────────────────────────────────────

_SAMPLE_LINES = [
    {
        "cn_code": "72081000",
        "country_of_origin": "CN",
        "net_mass_t": _D("10"),
        "direct_tco2e": _D("19"),
        "indirect_tco2e": _D("1"),
        "see_tco2e_per_t": _D("2.0"),
        "calculation_method": "default",
        "production_route": "BF_BOF",
        "installation_id": "INST-001",
    },
    {
        "cn_code": "76011000",
        "country_of_origin": "IN",
        "net_mass_t": _D("5"),
        "direct_tco2e": _D("11.8"),
        "indirect_tco2e": _D("2.3"),
        "see_tco2e_per_t": _D("2.82"),
        "calculation_method": "actual",
    },
]


def _build_xml(lines=None, **kwargs):
    defaults = dict(
        importer_eori="DE12345678900001",
        importer_name="Acme GmbH",
        reporting_year=2024,
        reporting_quarter=2,
        goods_lines=lines or _SAMPLE_LINES,
        total_embedded_tco2e=_D("34.1"),
        net_liability_tco2e=_D("34.1"),
        cbam_certificates_required=35,
        carbon_price_deduction_tco2e=_D("0"),
        eu_ets_price_eur=_D("65"),
    )
    defaults.update(kwargs)
    return build_quarterly_declaration(**defaults)


def _parse(xml_str: str) -> ET.Element:
    return ET.fromstring(xml_str.encode())


def _find(root: ET.Element, *path: str) -> ET.Element | None:
    current = root
    for part in path:
        current = current.find(_tag(part))
        if current is None:
            return None
    return current


def _text(root: ET.Element, *path: str) -> str | None:
    el = _find(root, *path)
    return el.text if el is not None else None


# ── XML well-formedness ────────────────────────────────────────────────────────

class TestXMLWellFormedness:
    def test_output_is_valid_xml(self):
        xml = _build_xml()
        root = _parse(xml)
        assert root is not None

    def test_root_tag_is_quarterly_declaration(self):
        xml = _build_xml()
        root = _parse(xml)
        assert root.tag == _tag("quarterlyDeclaration")

    def test_xml_declaration_present(self):
        xml = _build_xml()
        assert xml.strip().startswith("<?xml")

    def test_namespace_in_output(self):
        xml = _build_xml()
        assert _CBAM_NS in xml

    def test_generated_at_attribute(self):
        xml = _build_xml()
        root = _parse(xml)
        assert root.attrib.get("generatedAt")

    def test_version_attribute(self):
        xml = _build_xml()
        root = _parse(xml)
        assert root.attrib.get("version") == "1.0"


# ── Declarant block ────────────────────────────────────────────────────────────

class TestDeclarantBlock:
    def test_eori_present(self):
        xml = _build_xml()
        root = _parse(xml)
        assert _text(root, "declarant", "eori") == "DE12345678900001"

    def test_name_present_when_given(self):
        xml = _build_xml()
        root = _parse(xml)
        assert _text(root, "declarant", "name") == "Acme GmbH"

    def test_name_absent_when_not_given(self):
        xml = _build_xml(importer_name=None)
        root = _parse(xml)
        assert _find(root, "declarant", "name") is None


# ── Reporting period ──────────────────────────────────────────────────────────

class TestReportingPeriod:
    def test_period_code_format(self):
        xml = _build_xml(reporting_year=2024, reporting_quarter=3)
        root = _parse(xml)
        assert _text(root, "reportingPeriod", "periodCode") == "2024Q3"

    def test_year_and_quarter(self):
        xml = _build_xml(reporting_year=2025, reporting_quarter=1)
        root = _parse(xml)
        assert _text(root, "reportingPeriod", "year") == "2025"
        assert _text(root, "reportingPeriod", "quarter") == "1"

    def test_start_date_q2(self):
        xml = _build_xml(reporting_year=2024, reporting_quarter=2)
        root = _parse(xml)
        assert _text(root, "reportingPeriod", "startDate") == "2024-04-01"

    def test_end_date_q2(self):
        xml = _build_xml(reporting_year=2024, reporting_quarter=2)
        root = _parse(xml)
        assert _text(root, "reportingPeriod", "endDate") == "2024-06-30"

    def test_start_date_q1(self):
        xml = _build_xml(reporting_year=2024, reporting_quarter=1)
        root = _parse(xml)
        assert _text(root, "reportingPeriod", "startDate") == "2024-01-01"

    def test_end_date_q4(self):
        xml = _build_xml(reporting_year=2024, reporting_quarter=4)
        root = _parse(xml)
        assert _text(root, "reportingPeriod", "endDate") == "2024-12-31"


# ── Goods lines ────────────────────────────────────────────────────────────────

class TestGoodsLines:
    def test_correct_number_of_lines(self):
        xml = _build_xml()
        root = _parse(xml)
        goods_el = root.find(_tag("goodsImported"))
        lines = goods_el.findall(_tag("goodsLine"))
        assert len(lines) == 2

    def test_line_numbers_assigned(self):
        xml = _build_xml()
        root = _parse(xml)
        goods_el = root.find(_tag("goodsImported"))
        lines = goods_el.findall(_tag("goodsLine"))
        assert lines[0].attrib["lineNumber"] == "1"
        assert lines[1].attrib["lineNumber"] == "2"

    def test_cn_code_present(self):
        xml = _build_xml()
        root = _parse(xml)
        goods_el = root.find(_tag("goodsImported"))
        first_line = goods_el.findall(_tag("goodsLine"))[0]
        assert first_line.find(_tag("cnCode")).text == "72081000"

    def test_country_of_origin_present(self):
        xml = _build_xml()
        root = _parse(xml)
        goods_el = root.find(_tag("goodsImported"))
        first_line = goods_el.findall(_tag("goodsLine"))[0]
        assert first_line.find(_tag("countryOfOrigin")).text == "CN"

    def test_net_mass_present(self):
        xml = _build_xml()
        root = _parse(xml)
        goods_el = root.find(_tag("goodsImported"))
        first_line = goods_el.findall(_tag("goodsLine"))[0]
        assert first_line.find(_tag("netMassTonnes")).text == "10.000"

    def test_emissions_block_present(self):
        xml = _build_xml()
        root = _parse(xml)
        goods_el = root.find(_tag("goodsImported"))
        first_line = goods_el.findall(_tag("goodsLine"))[0]
        emiss = first_line.find(_tag("embeddedEmissions"))
        assert emiss is not None
        assert emiss.find(_tag("directEmissions")) is not None
        assert emiss.find(_tag("indirectEmissions")) is not None
        assert emiss.find(_tag("totalEmbedded")) is not None
        assert emiss.find(_tag("specificEmbeddedEmissions")) is not None

    def test_calculation_method_present(self):
        xml = _build_xml()
        root = _parse(xml)
        goods_el = root.find(_tag("goodsImported"))
        first_line = goods_el.findall(_tag("goodsLine"))[0]
        emiss = first_line.find(_tag("embeddedEmissions"))
        assert emiss.find(_tag("calculationMethod")).text == "default"

    def test_production_route_included_when_given(self):
        xml = _build_xml()
        root = _parse(xml)
        goods_el = root.find(_tag("goodsImported"))
        first_line = goods_el.findall(_tag("goodsLine"))[0]
        assert first_line.find(_tag("productionRoute")).text == "BF_BOF"

    def test_installation_id_included_when_given(self):
        xml = _build_xml()
        root = _parse(xml)
        goods_el = root.find(_tag("goodsImported"))
        first_line = goods_el.findall(_tag("goodsLine"))[0]
        assert first_line.find(_tag("installationId")).text == "INST-001"

    def test_production_route_absent_when_not_given(self):
        xml = _build_xml()
        root = _parse(xml)
        goods_el = root.find(_tag("goodsImported"))
        second_line = goods_el.findall(_tag("goodsLine"))[1]
        assert second_line.find(_tag("productionRoute")) is None


# ── Aggregated emissions block ────────────────────────────────────────────────

class TestAggregatedEmissions:
    def test_total_embedded_emissions_present(self):
        xml = _build_xml(total_embedded_tco2e=_D("34.1"))
        root = _parse(xml)
        agg = root.find(_tag("embeddedEmissions"))
        assert agg is not None
        total_el = agg.find(_tag("totalEmbeddedEmissions"))
        assert total_el is not None
        assert float(total_el.text) == pytest.approx(34.1)

    def test_total_net_mass_present(self):
        xml = _build_xml()
        root = _parse(xml)
        agg = root.find(_tag("embeddedEmissions"))
        mass_el = agg.find(_tag("totalNetMassTonnes"))
        assert mass_el is not None
        assert float(mass_el.text) == pytest.approx(15.0)  # 10 + 5


# ── CBAM certificates block ───────────────────────────────────────────────────

class TestCBAMCertificates:
    def test_certificates_required_present(self):
        xml = _build_xml(cbam_certificates_required=35)
        root = _parse(xml)
        certs = root.find(_tag("cbamCertificates"))
        assert certs.find(_tag("certificatesRequired")).text == "35"

    def test_net_liability_present(self):
        xml = _build_xml(net_liability_tco2e=_D("34.1"))
        root = _parse(xml)
        certs = root.find(_tag("cbamCertificates"))
        net_el = certs.find(_tag("netLiabilityTco2e"))
        assert float(net_el.text) == pytest.approx(34.1)

    def test_art9_deduction_present(self):
        xml = _build_xml(carbon_price_deduction_tco2e=_D("5.5"))
        root = _parse(xml)
        certs = root.find(_tag("cbamCertificates"))
        ded_el = certs.find(_tag("art9DeductionTco2e"))
        assert float(ded_el.text) == pytest.approx(5.5)

    def test_ets_price_present_when_given(self):
        xml = _build_xml(eu_ets_price_eur=_D("65"))
        root = _parse(xml)
        certs = root.find(_tag("cbamCertificates"))
        price_el = certs.find(_tag("euEtsPriceEur"))
        assert price_el is not None
        assert float(price_el.text) == pytest.approx(65.0)

    def test_ets_price_absent_when_not_given(self):
        xml = _build_xml(eu_ets_price_eur=None)
        root = _parse(xml)
        certs = root.find(_tag("cbamCertificates"))
        assert certs.find(_tag("euEtsPriceEur")) is None


# ── Structural validation ──────────────────────────────────────────────────────

class TestValidateXMLStructure:
    def test_valid_xml_returns_no_errors(self):
        xml = _build_xml()
        errors = validate_xml_structure(xml)
        assert errors == [], f"Unexpected errors: {errors}"

    def test_invalid_root_tag_flagged(self):
        bad_xml = '<root xmlns:cbam="urn:wrong"><data/></root>'
        errors = validate_xml_structure(bad_xml)
        assert any("Root element" in e for e in errors)

    def test_malformed_xml_flagged(self):
        errors = validate_xml_structure("<unclosed>")
        assert any("parse error" in e.lower() for e in errors)

    def test_missing_goods_line_flagged(self):
        xml = build_quarterly_declaration(
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            goods_lines=[],  # empty → should flag
        )
        errors = validate_xml_structure(xml)
        assert any("goodsLine" in e for e in errors)

    def test_missing_eori_flagged(self):
        # Build with valid EORI then surgically remove it
        xml = _build_xml()
        root = ET.fromstring(xml.encode())
        declarant = root.find(_tag("declarant"))
        eori_el = declarant.find(_tag("eori"))
        eori_el.text = ""  # empty text
        modified = ET.tostring(root, encoding="unicode")
        errors = validate_xml_structure(modified)
        assert any("eori" in e.lower() for e in errors)


# ── Integration: build from reconciliation result ─────────────────────────────

class TestDeclarationFromReconciliation:
    def _make_case(self):
        return {
            "id": "case-1",
            "importer_eori": "DE12345678900001",
            "reporting_year": 2024,
            "reporting_quarter": 2,
            "origin_country": "CN",
            "carbon_price_paid_eur": _D("0"),
            "goods_lines": [{
                "goods_line_id": "gl-1",
                "cn_code": "72081000",
                "supplier_eori": "",
                "net_mass_kg": _D("10000"),
                "direct_kgco2e": _D("19000"),
                "indirect_kgco2e": _D("1000"),
            }],
        }

    def test_roundtrip_produces_valid_xml(self):
        result = reconcile_quarter(
            cases=[self._make_case()],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=_D("65"),
        )
        gl = [{
            "cn_code": "72081000",
            "country_of_origin": "CN",
            "net_mass_t": _D("10"),
            "direct_tco2e": _D("19"),
            "indirect_tco2e": _D("1"),
            "see_tco2e_per_t": _D("2.0"),
            "calculation_method": "default",
        }]
        xml = declaration_from_reconciliation(result, gl, importer_name="Test Corp")
        errors = validate_xml_structure(xml)
        assert errors == [], f"Unexpected validation errors: {errors}"

    def test_roundtrip_certificates_match(self):
        result = reconcile_quarter(
            cases=[self._make_case()],
            importer_eori="DE12345678900001",
            reporting_year=2024,
            reporting_quarter=2,
            eu_ets_price_eur=_D("65"),
        )
        gl = [{
            "cn_code": "72081000",
            "country_of_origin": "CN",
            "net_mass_t": _D("10"),
            "direct_tco2e": _D("19"),
            "indirect_tco2e": _D("1"),
            "see_tco2e_per_t": _D("2.0"),
            "calculation_method": "default",
        }]
        xml = declaration_from_reconciliation(result, gl)
        root = ET.fromstring(xml.encode())
        certs_el = root.find(_tag("cbamCertificates"))
        assert int(certs_el.find(_tag("certificatesRequired")).text) == result.cbam_certificates_required
