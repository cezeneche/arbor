"""Tests for cbam_scope — CBAM scope determination (EU 2023/956 Art. 2).

Coverage:
- determine_cbam_scope():
    - CN code not in Annex I → out_of_scope
    - CN code in Annex I, EU member state origin → out_of_scope
    - CN code in Annex I, Annex II country (IS/LI/NO/CH) → out_of_scope
    - CN code in Annex I, third-country origin, above de minimis, valid EORI → in_scope
    - De minimis: value ≤ EUR 150 → out_of_scope
    - De minimis: value > EUR 150 → not excluded
    - De minimis: value not provided → skipped (no out_of_scope from this rule)
    - Missing origin → requires_review
    - Missing EORI → requires_review
    - Invalid EORI format → requires_review
    - Sector returned correctly for Annex I codes
    - Regulation refs populated and accurate
    - CN code normalisation (strips spaces/dashes)
    - Origin country normalisation (lower → upper)
    - EORI normalisation (lower → upper)
- ScopeStatus enum values
- DE_MINIMIS_THRESHOLD_EUR constant
- ANNEX_II_COUNTRIES and EU_MEMBER_STATES completeness spot-checks
- POST /cbam/scope-check API endpoint:
    - in_scope response
    - out_of_scope response (non-Annex-I code)
    - requires_review response (missing origin)
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from ledger_app.services.cbam_scope import (
    ANNEX_II_COUNTRIES,
    DE_MINIMIS_THRESHOLD_EUR,
    EU_MEMBER_STATES,
    ScopeStatus,
    ScopeDetermination,
    determine_cbam_scope,
)

_D = Decimal

# A valid CBAM-covered CN code (grey Portland cement, iron_steel heading)
_CEMENT_CN = "25232900"
_STEEL_CN = "72081000"
_OUT_OF_SCOPE_CN = "84713000"   # laptop computers — not in Annex I
_VALID_EORI = "DE123456789"
_THIRD_COUNTRY = "CN"


# ── Constants ─────────────────────────────────────────────────────────────────

class TestConstants:
    def test_de_minimis_threshold(self):
        assert DE_MINIMIS_THRESHOLD_EUR == _D("150")

    def test_annex_ii_contains_eea(self):
        for code in ("IS", "LI", "NO"):
            assert code in ANNEX_II_COUNTRIES, f"{code} should be in Annex II"

    def test_annex_ii_contains_switzerland(self):
        assert "CH" in ANNEX_II_COUNTRIES

    def test_eu_member_states_count(self):
        assert len(EU_MEMBER_STATES) == 27  # EU-27

    def test_eu_member_states_spot_check(self):
        for code in ("DE", "FR", "IT", "PL", "SE"):
            assert code in EU_MEMBER_STATES

    def test_eu_and_annex_ii_do_not_overlap(self):
        assert EU_MEMBER_STATES.isdisjoint(ANNEX_II_COUNTRIES)


# ── determine_cbam_scope — out_of_scope paths ─────────────────────────────────

class TestOutOfScope:
    def test_cn_code_not_in_annex_i(self):
        result = determine_cbam_scope(_OUT_OF_SCOPE_CN, _THIRD_COUNTRY)
        assert result.status == ScopeStatus.OUT_OF_SCOPE
        assert result.sector is None
        assert any("annex_i:not_covered" in r for r in result.reasons)

    def test_eu_member_state_origin(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country="DE",
                                      importer_eori=_VALID_EORI)
        assert result.status == ScopeStatus.OUT_OF_SCOPE
        assert any("eu_member_state" in r for r in result.reasons)

    def test_all_eu_member_states_excluded(self):
        for code in EU_MEMBER_STATES:
            result = determine_cbam_scope(_CEMENT_CN, origin_country=code)
            assert result.status == ScopeStatus.OUT_OF_SCOPE, (
                f"EU member state {code} should be out_of_scope"
            )

    def test_annex_ii_norway_excluded(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country="NO",
                                      importer_eori=_VALID_EORI)
        assert result.status == ScopeStatus.OUT_OF_SCOPE
        assert any("annex_ii" in r for r in result.reasons)

    def test_annex_ii_switzerland_excluded(self):
        result = determine_cbam_scope(_STEEL_CN, origin_country="CH")
        assert result.status == ScopeStatus.OUT_OF_SCOPE

    def test_annex_ii_iceland_excluded(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country="IS")
        assert result.status == ScopeStatus.OUT_OF_SCOPE

    def test_annex_ii_liechtenstein_excluded(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country="LI")
        assert result.status == ScopeStatus.OUT_OF_SCOPE

    def test_de_minimis_exactly_150_excluded(self):
        result = determine_cbam_scope(
            _CEMENT_CN, origin_country=_THIRD_COUNTRY,
            consignment_value_eur=_D("150"),
            importer_eori=_VALID_EORI,
        )
        assert result.status == ScopeStatus.OUT_OF_SCOPE
        assert any("de_minimis:below_threshold" in r for r in result.reasons)

    def test_de_minimis_below_150_excluded(self):
        result = determine_cbam_scope(
            _CEMENT_CN, origin_country=_THIRD_COUNTRY,
            consignment_value_eur=_D("49.99"),
            importer_eori=_VALID_EORI,
        )
        assert result.status == ScopeStatus.OUT_OF_SCOPE

    def test_annex_i_false_takes_priority_over_de_minimis(self):
        """Non-Annex-I code stays out_of_scope even above de minimis."""
        result = determine_cbam_scope(
            _OUT_OF_SCOPE_CN, origin_country=_THIRD_COUNTRY,
            consignment_value_eur=_D("5000"),
        )
        assert result.status == ScopeStatus.OUT_OF_SCOPE
        assert any("annex_i:not_covered" in r for r in result.reasons)


# ── determine_cbam_scope — in_scope path ──────────────────────────────────────

class TestInScope:
    def test_full_in_scope(self):
        """Covered CN, third country, above de minimis, valid EORI → in_scope."""
        result = determine_cbam_scope(
            _CEMENT_CN,
            origin_country=_THIRD_COUNTRY,
            consignment_value_eur=_D("5000"),
            importer_eori=_VALID_EORI,
        )
        assert result.status == ScopeStatus.IN_SCOPE
        assert result.sector == "cement"

    def test_in_scope_steel(self):
        result = determine_cbam_scope(
            _STEEL_CN,
            origin_country="IN",
            consignment_value_eur=_D("10000"),
            importer_eori="FR123456789012",
        )
        assert result.status == ScopeStatus.IN_SCOPE
        assert result.sector == "iron_steel"

    def test_in_scope_above_de_minimis(self):
        result = determine_cbam_scope(
            _CEMENT_CN, origin_country="TR",
            consignment_value_eur=_D("150.01"),
            importer_eori=_VALID_EORI,
        )
        assert result.status == ScopeStatus.IN_SCOPE
        assert any("above_threshold" in r for r in result.reasons)

    def test_in_scope_regulation_ref_present(self):
        result = determine_cbam_scope(
            _CEMENT_CN, origin_country="CN",
            consignment_value_eur=_D("1000"),
            importer_eori=_VALID_EORI,
        )
        assert result.status == ScopeStatus.IN_SCOPE
        assert any("2023/956" in ref for ref in result.regulation_refs)


# ── determine_cbam_scope — requires_review paths ──────────────────────────────

class TestRequiresReview:
    def test_missing_origin(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country=None,
                                      importer_eori=_VALID_EORI)
        assert result.status == ScopeStatus.REQUIRES_REVIEW
        assert any("origin:missing" in r for r in result.reasons)

    def test_missing_eori(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country=_THIRD_COUNTRY,
                                      importer_eori=None)
        assert result.status == ScopeStatus.REQUIRES_REVIEW
        assert any("eori:missing" in r for r in result.reasons)

    def test_invalid_eori_format(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country=_THIRD_COUNTRY,
                                      importer_eori="123INVALID")
        assert result.status == ScopeStatus.REQUIRES_REVIEW
        assert any("eori:format_invalid" in r for r in result.reasons)

    def test_eori_too_short(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country=_THIRD_COUNTRY,
                                      importer_eori="DE")
        assert result.status == ScopeStatus.REQUIRES_REVIEW

    def test_missing_origin_and_eori_both_flagged(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country=None, importer_eori=None)
        assert result.status == ScopeStatus.REQUIRES_REVIEW
        reasons_joined = " ".join(result.reasons)
        assert "origin:missing" in reasons_joined
        assert "eori:missing" in reasons_joined

    def test_no_value_does_not_cause_requires_review(self):
        """Missing consignment value skips de minimis but doesn't force requires_review."""
        result = determine_cbam_scope(
            _CEMENT_CN, origin_country=_THIRD_COUNTRY,
            consignment_value_eur=None,
            importer_eori=_VALID_EORI,
        )
        assert result.status == ScopeStatus.IN_SCOPE
        assert any("de_minimis:value_not_provided" in r for r in result.reasons)


# ── Normalisation ─────────────────────────────────────────────────────────────

class TestNormalisation:
    def test_cn_code_strips_spaces(self):
        result = determine_cbam_scope("2523 2900", origin_country=_THIRD_COUNTRY,
                                      importer_eori=_VALID_EORI)
        assert result.cn_code == "25232900"

    def test_cn_code_strips_dashes(self):
        result = determine_cbam_scope("2523-2900", origin_country=_THIRD_COUNTRY,
                                      importer_eori=_VALID_EORI)
        assert result.cn_code == "25232900"

    def test_origin_uppercased(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country="cn",
                                      importer_eori=_VALID_EORI)
        assert result.origin_country == "CN"

    def test_eori_uppercased(self):
        result = determine_cbam_scope(_CEMENT_CN, origin_country=_THIRD_COUNTRY,
                                      importer_eori="de123456789",
                                      consignment_value_eur=_D("1000"))
        assert result.importer_eori == "DE123456789"
        assert result.status == ScopeStatus.IN_SCOPE


# ── ScopeDetermination fields ─────────────────────────────────────────────────

class TestScopeDetermination:
    def test_result_echoes_inputs(self):
        result = determine_cbam_scope(
            _CEMENT_CN, origin_country="CN",
            consignment_value_eur=_D("999"),
            importer_eori=_VALID_EORI,
        )
        assert result.cn_code == _CEMENT_CN
        assert result.origin_country == "CN"
        assert result.consignment_value_eur == _D("999")
        assert result.importer_eori == _VALID_EORI

    def test_sector_none_for_out_of_scope_cn(self):
        result = determine_cbam_scope(_OUT_OF_SCOPE_CN, _THIRD_COUNTRY)
        assert result.sector is None

    def test_regulation_refs_no_duplicates(self):
        result = determine_cbam_scope(
            _CEMENT_CN, origin_country=_THIRD_COUNTRY,
            consignment_value_eur=_D("5000"),
            importer_eori=_VALID_EORI,
        )
        assert len(result.regulation_refs) == len(set(result.regulation_refs))


# ── API endpoint ──────────────────────────────────────────────────────────────

class TestScopeCheckAPI:
    def _client(self):
        import os
        os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")
        from ledger_app.testing import _client_with_fake_engine
        client, _ = _client_with_fake_engine()
        return client

    def test_in_scope_response(self):
        client = self._client()
        resp = client.post("/api/cbam/scope-check", json={
            "cn_code": "25232900",
            "origin_country": "CN",
            "consignment_value_eur": "5000",
            "importer_eori": "DE123456789",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "in_scope"
        assert data["sector"] == "cement"
        assert data["cn_code"] == "25232900"

    def test_out_of_scope_non_annex_i(self):
        client = self._client()
        resp = client.post("/api/cbam/scope-check", json={
            "cn_code": "84713000",
            "origin_country": "CN",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "out_of_scope"

    def test_out_of_scope_annex_ii_country(self):
        client = self._client()
        resp = client.post("/api/cbam/scope-check", json={
            "cn_code": "25232900",
            "origin_country": "NO",
            "importer_eori": "DE123456789",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "out_of_scope"

    def test_requires_review_missing_origin(self):
        client = self._client()
        resp = client.post("/api/cbam/scope-check", json={
            "cn_code": "25232900",
            "importer_eori": "DE123456789",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "requires_review"

    def test_out_of_scope_de_minimis(self):
        client = self._client()
        resp = client.post("/api/cbam/scope-check", json={
            "cn_code": "25232900",
            "origin_country": "IN",
            "consignment_value_eur": "100",
            "importer_eori": "DE123456789",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "out_of_scope"

    def test_response_includes_reasons_and_refs(self):
        client = self._client()
        resp = client.post("/api/cbam/scope-check", json={
            "cn_code": "25232900",
            "origin_country": "CN",
            "consignment_value_eur": "5000",
            "importer_eori": "DE123456789",
        })
        data = resp.json()
        assert isinstance(data["reasons"], list)
        assert len(data["reasons"]) > 0
        assert isinstance(data["regulation_refs"], list)
        assert any("2023/956" in ref for ref in data["regulation_refs"])
