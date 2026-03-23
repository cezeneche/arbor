"""Tests for cbam_carbon_pricing — recognised Art. 9 carbon pricing scheme lookup.

Coverage:
- lookup_carbon_pricing_scheme():
    - GB → RecognisedScheme with correct name and type
    - Case-insensitive input ("gb" == "GB")
    - Unknown third-country ("CN", "IN") → None
    - EU member state ("DE") → None (not subject to CBAM)
    - Annex II country ("NO", "CH") → None (excluded from CBAM entirely)
    - Empty string → None
    - None → None (no error)
    - scheme_name and regulation_ref populated for known scheme
- get_all_recognised_schemes():
    - Returns a list (non-empty)
    - Contains GB
    - Sorted by country_code
    - No duplicate country codes
- RecognisedScheme fields:
    - country_code, scheme_name, scheme_type, regulation_ref present
    - scheme_type is one of "ets", "carbon_tax", "hybrid"
- POST /cases/{case_id}/liability integration:
    - origin_country="GB" → carbon_pricing_scheme_applies=True, scheme_name in response
    - origin_country="CN" → carbon_pricing_scheme_applies=False
    - origin_country absent → carbon_pricing_scheme_applies=False
- GET /cbam/carbon-pricing-schemes:
    - Returns 200, "schemes" list, "count" int, "regulation_ref"
    - GB entry present
"""

from __future__ import annotations

import pytest

from ledger_app.services.cbam_carbon_pricing import (
    RecognisedScheme,
    get_all_recognised_schemes,
    lookup_carbon_pricing_scheme,
)


# ── lookup_carbon_pricing_scheme ──────────────────────────────────────────────

class TestLookup:
    def test_gb_recognised(self):
        scheme = lookup_carbon_pricing_scheme("GB")
        assert scheme is not None
        assert isinstance(scheme, RecognisedScheme)

    def test_gb_scheme_name_contains_uk_ets(self):
        scheme = lookup_carbon_pricing_scheme("GB")
        assert "UK ETS" in scheme.scheme_name

    def test_gb_scheme_type_is_ets(self):
        scheme = lookup_carbon_pricing_scheme("GB")
        assert scheme.scheme_type == "ets"

    def test_gb_regulation_ref_present(self):
        scheme = lookup_carbon_pricing_scheme("GB")
        assert scheme.regulation_ref
        assert "2023/956" in scheme.regulation_ref

    def test_gb_country_code_correct(self):
        scheme = lookup_carbon_pricing_scheme("GB")
        assert scheme.country_code == "GB"

    def test_case_insensitive_lowercase(self):
        scheme_lower = lookup_carbon_pricing_scheme("gb")
        scheme_upper = lookup_carbon_pricing_scheme("GB")
        assert scheme_lower == scheme_upper

    def test_case_insensitive_mixed(self):
        scheme = lookup_carbon_pricing_scheme("Gb")
        assert scheme is not None
        assert scheme.country_code == "GB"

    def test_unknown_third_country_none(self):
        assert lookup_carbon_pricing_scheme("CN") is None

    def test_india_no_recognised_scheme(self):
        assert lookup_carbon_pricing_scheme("IN") is None

    def test_turkey_no_recognised_scheme(self):
        assert lookup_carbon_pricing_scheme("TR") is None

    def test_eu_member_state_returns_none(self):
        """EU member states are not subject to CBAM and have no Art. 9 deduction."""
        assert lookup_carbon_pricing_scheme("DE") is None
        assert lookup_carbon_pricing_scheme("FR") is None
        assert lookup_carbon_pricing_scheme("PL") is None

    def test_annex_ii_norway_not_in_table(self):
        """NO is excluded from CBAM (Annex II) — no Art. 9 entry."""
        assert lookup_carbon_pricing_scheme("NO") is None

    def test_annex_ii_switzerland_not_in_table(self):
        """CH is excluded from CBAM (Annex II) — no Art. 9 entry."""
        assert lookup_carbon_pricing_scheme("CH") is None

    def test_annex_ii_iceland_not_in_table(self):
        assert lookup_carbon_pricing_scheme("IS") is None

    def test_annex_ii_liechtenstein_not_in_table(self):
        assert lookup_carbon_pricing_scheme("LI") is None

    def test_empty_string_returns_none(self):
        assert lookup_carbon_pricing_scheme("") is None

    def test_none_input_returns_none(self):
        assert lookup_carbon_pricing_scheme(None) is None

    def test_whitespace_stripped(self):
        scheme = lookup_carbon_pricing_scheme("  GB  ")
        assert scheme is not None


# ── get_all_recognised_schemes ────────────────────────────────────────────────

class TestGetAll:
    def test_returns_list(self):
        schemes = get_all_recognised_schemes()
        assert isinstance(schemes, list)

    def test_non_empty(self):
        assert len(get_all_recognised_schemes()) >= 1

    def test_contains_gb(self):
        codes = [s.country_code for s in get_all_recognised_schemes()]
        assert "GB" in codes

    def test_sorted_by_country_code(self):
        schemes = get_all_recognised_schemes()
        codes = [s.country_code for s in schemes]
        assert codes == sorted(codes)

    def test_no_duplicate_country_codes(self):
        schemes = get_all_recognised_schemes()
        codes = [s.country_code for s in schemes]
        assert len(codes) == len(set(codes))

    def test_all_have_required_fields(self):
        for s in get_all_recognised_schemes():
            assert s.country_code
            assert s.scheme_name
            assert s.scheme_type in ("ets", "carbon_tax", "hybrid")
            assert s.regulation_ref


# ── RecognisedScheme dataclass ────────────────────────────────────────────────

class TestRecognisedScheme:
    def test_frozen(self):
        scheme = lookup_carbon_pricing_scheme("GB")
        with pytest.raises((AttributeError, TypeError)):
            scheme.scheme_name = "tampered"  # type: ignore[misc]

    def test_equality(self):
        s1 = lookup_carbon_pricing_scheme("GB")
        s2 = lookup_carbon_pricing_scheme("gb")
        assert s1 == s2


# ── API endpoint: GET /cbam/carbon-pricing-schemes ───────────────────────────

class TestCarbonPricingSchemesAPI:
    def _client(self):
        import os
        os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")
        from ledger_app.testing import _client_with_fake_engine
        client, _ = _client_with_fake_engine()
        return client

    def test_returns_200(self):
        resp = self._client().get("/api/cbam/carbon-pricing-schemes")
        assert resp.status_code == 200

    def test_response_has_schemes_list(self):
        data = self._client().get("/api/cbam/carbon-pricing-schemes").json()
        assert "schemes" in data
        assert isinstance(data["schemes"], list)

    def test_response_has_count(self):
        data = self._client().get("/api/cbam/carbon-pricing-schemes").json()
        assert data["count"] == len(data["schemes"])

    def test_response_has_regulation_ref(self):
        data = self._client().get("/api/cbam/carbon-pricing-schemes").json()
        assert "2023/956" in data["regulation_ref"]

    def test_gb_entry_present(self):
        data = self._client().get("/api/cbam/carbon-pricing-schemes").json()
        codes = [s["country_code"] for s in data["schemes"]]
        assert "GB" in codes

    def test_gb_entry_fields(self):
        data = self._client().get("/api/cbam/carbon-pricing-schemes").json()
        gb = next(s for s in data["schemes"] if s["country_code"] == "GB")
        assert "UK ETS" in gb["scheme_name"]
        assert gb["scheme_type"] == "ets"
        assert "2023/956" in gb["regulation_ref"]


# ── Integration: liability endpoint scheme detection ──────────────────────────

def _make_case_with_emission(conn, suffix: str, origin_country: str | None = None):
    """Populate FakeConnection dicts for one case → shipment → goods_line → emission."""
    from datetime import datetime
    now = datetime.utcnow()
    case_id  = f"aaaaaaaa-{suffix}"
    ship_id  = f"bbbbbbbb-{suffix}"
    gl_id    = f"cccccccc-{suffix}"
    em_id    = f"dddddddd-{suffix}"

    conn.cases[case_id] = {
        "id": case_id, "importer_eori": "GB123456789",
        "importer_name": "Test", "reporting_year": 2025, "reporting_quarter": 1,
        "status": "draft", "created_at": now, "updated_at": now,
    }
    conn.shipments[ship_id] = {
        "id": ship_id, "case_id": case_id,
        "import_date": "2025-01-15", "origin_country": origin_country,
        "entry_reference": None, "incoterm": None, "created_at": now,
    }
    conn.goods_lines[gl_id] = {
        "id": gl_id, "shipment_id": ship_id,
        "cn_code": "72081000", "sector": "iron_steel",
        "quantity": 1000.0, "quantity_unit": "kg",
        "installation_id": None, "installation_name": None, "created_at": now,
    }
    conn.emissions[em_id] = {
        "id": em_id, "goods_line_id": gl_id, "method": "actual",
        "direct_embedded_kgco2e": 500.0, "indirect_embedded_kgco2e": 50.0,
        "version": 1, "created_at": now,
    }
    return case_id


class TestLiabilitySchemeDetection:
    """Verify that POST /cases/{id}/liability returns scheme info."""

    def _setup(self):
        import os
        os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")
        from ledger_app.testing import _client_with_fake_engine
        return _client_with_fake_engine()

    def _post_liability(self, client, case_id, eu_ets, origin_country=None):
        from shared_auth.testing import make_test_token
        payload = {"eu_ets_price_eur": eu_ets}
        if origin_country is not None:
            payload["origin_country"] = origin_country
        return client.post(
            f"/api/cbam/cases/{case_id}/liability",
            json=payload,
            headers={"Authorization": f"Bearer {make_test_token(scopes=['cbam:read', 'cbam:write'])}"},
        )

    def test_gb_origin_scheme_applies(self):
        client, conn = self._setup()
        case_id = _make_case_with_emission(conn, "0001-0001-0001-000000000001", origin_country="GB")

        resp = self._post_liability(client, case_id, 60, origin_country="GB")
        assert resp.status_code == 200
        data = resp.json()
        assert data["carbon_pricing_scheme_applies"] is True
        assert "UK ETS" in data["carbon_pricing_scheme_name"]
        assert data["carbon_pricing_scheme_type"] == "ets"
        assert data["origin_country"] == "GB"

    def test_cn_origin_no_scheme(self):
        client, conn = self._setup()
        case_id = _make_case_with_emission(conn, "0002-0002-0002-000000000002", origin_country="CN")

        resp = self._post_liability(client, case_id, 60, origin_country="CN")
        assert resp.status_code == 200
        data = resp.json()
        assert data["carbon_pricing_scheme_applies"] is False
        assert data["carbon_pricing_scheme_name"] is None
        assert data["origin_country"] == "CN"

    def test_no_origin_country_no_scheme(self):
        client, conn = self._setup()
        case_id = _make_case_with_emission(conn, "0003-0003-0003-000000000003")

        resp = self._post_liability(client, case_id, 60)
        assert resp.status_code == 200
        data = resp.json()
        assert data["carbon_pricing_scheme_applies"] is False
        assert data["origin_country"] is None
