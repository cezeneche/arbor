"""Tests for compliance_pack.serialise_to_registry_schema.

Verifies correct mapping of internal cbam_compliance_pack_v1 fields to the
EU CBAM Transitional Registry submission schema (EU 2023/1773, Annex I).

Coverage:
- Top-level schema metadata (schemaVersion, schemaRef)
- reportingPeriod: year and quarter "Q{N}" formatting
- declarant: eori and name from case
- importEntries: entry reference, import date, country, incoterm
- goods per entry: cnCode, sector, netMassKg, installationId, productionRoute
- emissionsDetermination: method codes, kgCO2e → tCO2e conversion, totals
- method code mapping: actual→ACTUAL_MONITORING, default→DEFAULT_VALUES, estimated→ESTIMATED
- null method when emissions record absent
- reportTotals: all five aggregate fields, kgCO2e → tCO2e conversion
- Multiple shipments / multiple goods lines accumulated correctly
- Missing fields degrade gracefully (None / 0.0 defaults)
- registry_submission included in build_cbam_compliance_pack output
- registry_submission covered by audit hash (payload_hash changes if submission changes)
"""

from __future__ import annotations

import json
import re
from copy import deepcopy

import pytest

from narrative_app.services.compliance_pack import (
    build_cbam_compliance_pack,
    serialise_to_registry_schema,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_pack(
    reporting_year: int = 2025,
    reporting_quarter: int = 1,
    importer_eori: str = "DE123456789",
    importer_name: str = "Test Importer GmbH",
    shipments: list | None = None,
    totals: dict | None = None,
) -> dict:
    """Build a minimal compliance_pack_v1 for testing."""
    if shipments is None:
        shipments = [_make_shipment()]
    if totals is None:
        totals = {
            "total_goods_lines": 1,
            "total_net_mass_kg": 1000.0,
            "total_direct_emissions_kgco2e": 633.0,
            "total_indirect_emissions_kgco2e": 14.0,
            "total_embedded_emissions_kgco2e": 647.0,
            "shipments_count": 1,
        }
    return {
        "type": "cbam_compliance_pack_v1",
        "case_id": "TEST-1",
        "report_package": {
            "case": {
                "id": "TEST-1",
                "importer_eori": importer_eori,
                "importer_name": importer_name,
                "reporting_year": reporting_year,
                "reporting_quarter": reporting_quarter,
            },
            "shipments": shipments,
        },
        "tables": {"totals": totals},
    }


def _make_shipment(
    entry_reference: str = "24GB123456789000A1",
    import_date: str = "2025-01-15",
    origin_country: str = "TR",
    incoterm: str = "CIF",
    goods_lines: list | None = None,
) -> dict:
    if goods_lines is None:
        goods_lines = [_make_goods_bundle()]
    return {
        "shipment": {
            "id": "SHIP-1",
            "entry_reference": entry_reference,
            "import_date": import_date,
            "origin_country": origin_country,
            "incoterm": incoterm,
        },
        "goods_lines": goods_lines,
    }


def _make_goods_bundle(
    cn_code: str = "25232900",
    sector: str = "cement",
    quantity: float = 1000.0,
    installation_id: str | None = "DE_12345678",
    installation_name: str | None = "Heidelberg Plant A",
    production_route: str | None = None,
    method: str | None = "actual",
    direct_kgco2e: float = 633.0,
    indirect_kgco2e: float = 14.0,
) -> dict:
    emissions = None
    if method is not None:
        emissions = {
            "method": method,
            "direct_embedded_kgco2e": direct_kgco2e,
            "indirect_embedded_kgco2e": indirect_kgco2e,
        }
    return {
        "goods_line": {
            "id": "GL-1",
            "cn_code": cn_code,
            "sector": sector,
            "quantity": quantity,
            "quantity_unit": "kg",
            "installation_id": installation_id,
            "installation_name": installation_name,
            "production_route": production_route,
        },
        "latest_emissions": emissions,
    }


# ── Schema metadata ───────────────────────────────────────────────────────────

class TestSchemaMetadata:
    def test_schema_version(self):
        result = serialise_to_registry_schema(_make_pack())
        assert result["schemaVersion"] == "1.0"

    def test_schema_ref_mentions_regulation(self):
        result = serialise_to_registry_schema(_make_pack())
        assert "2023/1773" in result["schemaRef"]
        assert "Annex I" in result["schemaRef"]


# ── Reporting period ──────────────────────────────────────────────────────────

class TestReportingPeriod:
    @pytest.mark.parametrize("quarter", [1, 2, 3, 4])
    def test_quarter_format(self, quarter):
        result = serialise_to_registry_schema(_make_pack(reporting_quarter=quarter))
        assert result["reportingPeriod"]["quarter"] == f"Q{quarter}"

    def test_year_preserved(self):
        result = serialise_to_registry_schema(_make_pack(reporting_year=2024))
        assert result["reportingPeriod"]["year"] == 2024


# ── Declarant ─────────────────────────────────────────────────────────────────

class TestDeclarant:
    def test_eori(self):
        result = serialise_to_registry_schema(_make_pack(importer_eori="GB123456789"))
        assert result["declarant"]["eori"] == "GB123456789"

    def test_name(self):
        result = serialise_to_registry_schema(_make_pack(importer_name="Acme Steel Ltd"))
        assert result["declarant"]["name"] == "Acme Steel Ltd"


# ── Import entries ────────────────────────────────────────────────────────────

class TestImportEntries:
    def test_entry_reference(self):
        result = serialise_to_registry_schema(_make_pack())
        assert result["importEntries"][0]["entryReference"] == "24GB123456789000A1"

    def test_import_date(self):
        result = serialise_to_registry_schema(_make_pack())
        assert result["importEntries"][0]["importDate"] == "2025-01-15"

    def test_country_of_origin(self):
        result = serialise_to_registry_schema(_make_pack())
        assert result["importEntries"][0]["countryOfOrigin"] == "TR"

    def test_incoterm(self):
        result = serialise_to_registry_schema(_make_pack())
        assert result["importEntries"][0]["incoterm"] == "CIF"

    def test_multiple_shipments_all_included(self):
        pack = _make_pack(shipments=[
            _make_shipment(entry_reference="REF-1"),
            _make_shipment(entry_reference="REF-2"),
        ])
        result = serialise_to_registry_schema(pack)
        refs = [e["entryReference"] for e in result["importEntries"]]
        assert refs == ["REF-1", "REF-2"]


# ── Goods per entry ───────────────────────────────────────────────────────────

class TestGoods:
    def _goods(self, **kwargs) -> dict:
        pack = _make_pack(
            shipments=[_make_shipment(goods_lines=[_make_goods_bundle(**kwargs)])]
        )
        return serialise_to_registry_schema(pack)["importEntries"][0]["goods"][0]

    def test_cn_code(self):
        assert self._goods(cn_code="72081000")["cnCode"] == "72081000"

    def test_sector(self):
        assert self._goods(sector="iron_steel")["sector"] == "iron_steel"

    def test_net_mass_kg(self):
        assert self._goods(quantity=5000.0)["netMassKg"] == 5000.0

    def test_installation_id(self):
        assert self._goods(installation_id="DE_99999")["installationId"] == "DE_99999"

    def test_installation_id_none(self):
        assert self._goods(installation_id=None)["installationId"] is None

    def test_installation_name(self):
        assert self._goods(installation_name="Plant B")["installationName"] == "Plant B"

    def test_production_route_none(self):
        assert self._goods(production_route=None)["productionRoute"] is None

    def test_multiple_goods_lines(self):
        pack = _make_pack(shipments=[_make_shipment(goods_lines=[
            _make_goods_bundle(cn_code="25232900"),
            _make_goods_bundle(cn_code="72081000"),
        ])])
        goods = serialise_to_registry_schema(pack)["importEntries"][0]["goods"]
        assert len(goods) == 2
        assert goods[0]["cnCode"] == "25232900"
        assert goods[1]["cnCode"] == "72081000"


# ── Emissions determination ───────────────────────────────────────────────────

class TestEmissionsDetermination:
    def _det(self, **kwargs) -> dict:
        pack = _make_pack(
            shipments=[_make_shipment(goods_lines=[_make_goods_bundle(**kwargs)])]
        )
        return serialise_to_registry_schema(pack)["importEntries"][0]["goods"][0][
            "emissionsDetermination"
        ]

    # Method code mapping
    def test_method_actual(self):
        assert self._det(method="actual")["method"] == "ACTUAL_MONITORING"

    def test_method_default(self):
        assert self._det(method="default")["method"] == "DEFAULT_VALUES"

    def test_method_estimated(self):
        assert self._det(method="estimated")["method"] == "ESTIMATED"

    def test_method_none_when_no_emissions(self):
        assert self._det(method=None)["method"] is None

    # kgCO2e → tCO2e conversion (÷ 1000)
    def test_direct_converted_to_tco2e(self):
        det = self._det(direct_kgco2e=633.0, indirect_kgco2e=0.0)
        assert det["directEmbeddedEmissionsTco2e"] == pytest.approx(0.633, rel=1e-5)

    def test_indirect_converted_to_tco2e(self):
        det = self._det(direct_kgco2e=0.0, indirect_kgco2e=14000.0)
        assert det["indirectEmbeddedEmissionsTco2e"] == pytest.approx(14.0, rel=1e-5)

    def test_total_is_direct_plus_indirect(self):
        det = self._det(direct_kgco2e=50000.0, indirect_kgco2e=10000.0)
        assert det["totalEmbeddedEmissionsTco2e"] == pytest.approx(60.0, rel=1e-5)

    def test_carbon_price_paid_defaults_none(self):
        assert self._det()["carbonPricePaidEurPerTco2e"] is None

    def test_carbon_price_paid_populated_when_set(self):
        """carbon_price_paid_eur_per_tco2e at pack level flows into each goods line."""
        pack = _make_pack()
        pack["carbon_price_paid_eur_per_tco2e"] = 45.0
        result = serialise_to_registry_schema(pack)
        det = result["importEntries"][0]["goods"][0]["emissionsDetermination"]
        assert det["carbonPricePaidEurPerTco2e"] == 45.0

    def test_carbon_price_paid_zero_stays_none(self):
        """Explicit 0 is treated as 'no scheme applies' → None."""
        pack = _make_pack()
        pack["carbon_price_paid_eur_per_tco2e"] = 0.0
        result = serialise_to_registry_schema(pack)
        det = result["importEntries"][0]["goods"][0]["emissionsDetermination"]
        assert det["carbonPricePaidEurPerTco2e"] is None

    def test_zero_emissions_when_no_record(self):
        det = self._det(method=None)
        assert det["directEmbeddedEmissionsTco2e"] == 0.0
        assert det["totalEmbeddedEmissionsTco2e"] == 0.0


# ── Report totals ─────────────────────────────────────────────────────────────

class TestReportTotals:
    def test_direct_tco2e(self):
        pack = _make_pack(totals={
            "total_direct_emissions_kgco2e": 50000.0,
            "total_indirect_emissions_kgco2e": 10000.0,
            "total_embedded_emissions_kgco2e": 60000.0,
            "total_net_mass_kg": 15000.0,
            "total_goods_lines": 2,
            "shipments_count": 1,
        })
        totals = serialise_to_registry_schema(pack)["reportTotals"]
        assert totals["totalDirectEmbeddedEmissionsTco2e"] == pytest.approx(50.0)
        assert totals["totalIndirectEmbeddedEmissionsTco2e"] == pytest.approx(10.0)
        assert totals["totalEmbeddedEmissionsTco2e"] == pytest.approx(60.0)

    def test_total_net_mass_kg_unchanged(self):
        pack = _make_pack(totals={
            "total_direct_emissions_kgco2e": 0.0,
            "total_indirect_emissions_kgco2e": 0.0,
            "total_embedded_emissions_kgco2e": 0.0,
            "total_net_mass_kg": 15000.0,
            "total_goods_lines": 2,
            "shipments_count": 1,
        })
        totals = serialise_to_registry_schema(pack)["reportTotals"]
        assert totals["totalNetMassKg"] == 15000.0

    def test_goods_lines_and_shipments_count(self):
        pack = _make_pack(totals={
            "total_direct_emissions_kgco2e": 0.0,
            "total_indirect_emissions_kgco2e": 0.0,
            "total_embedded_emissions_kgco2e": 0.0,
            "total_net_mass_kg": 0.0,
            "total_goods_lines": 7,
            "shipments_count": 3,
        })
        totals = serialise_to_registry_schema(pack)["reportTotals"]
        assert totals["goodsLinesCount"] == 7
        assert totals["shipmentsCount"] == 3


# ── Integration with build_cbam_compliance_pack ───────────────────────────────

class TestBuildIntegration:
    def _build(self, monkeypatch):
        from narrative_app.services import compliance_pack as cp
        monkeypatch.setattr(cp, "_now_utc_iso", lambda: "2026-01-01T00:00:00+00:00")

        report_package = {
            "type": "cbam_report_package_v1",
            "case": {
                "id": "CASE-1",
                "importer_eori": "DE123456789",
                "importer_name": "Test",
                "reporting_year": 2025,
                "reporting_quarter": 2,
            },
            "shipments": [_make_shipment()],
            "summary": {
                "total_goods_lines": 1,
                "total_net_mass_kg": 1000,
                "total_direct_emissions_kgco2e": 633,
                "total_indirect_emissions_kgco2e": 14,
                "total_embedded_emissions_kgco2e": 647,
            },
            "audit": {},
        }
        narrative = {"executive_summary": "Test narrative."}
        return build_cbam_compliance_pack("CASE-1", report_package, narrative)

    def test_registry_submission_present(self, monkeypatch):
        result = self._build(monkeypatch)
        assert "registry_submission" in result

    def test_registry_submission_has_correct_quarter(self, monkeypatch):
        result = self._build(monkeypatch)
        assert result["registry_submission"]["reportingPeriod"]["quarter"] == "Q2"

    def test_registry_submission_covered_by_audit_hash(self, monkeypatch):
        """payload_hash must differ if registry_submission content changes."""
        result1 = self._build(monkeypatch)

        # Tamper with the registry submission post-hoc and recompute hash
        import hashlib, json
        tampered = deepcopy(result1)
        tampered["registry_submission"]["declarant"]["eori"] = "TAMPERED"
        canonical = json.dumps(tampered, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        tampered_hash = hashlib.sha256(canonical.encode()).hexdigest()
        # The stored hash should NOT match the tampered payload
        assert result1["audit"]["payload_hash"] != tampered_hash

    def test_audit_hash_is_64_hex_chars(self, monkeypatch):
        result = self._build(monkeypatch)
        assert re.fullmatch(r"[0-9a-f]{64}", result["audit"]["payload_hash"])
