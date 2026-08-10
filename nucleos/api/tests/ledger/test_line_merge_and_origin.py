"""Goods lines are not silently dropped, and origin country is actually found.

RISKS.md N1 and N2, both on the live extraction path.

N1: Claude's line items were merged only when the deterministic layer found
ZERO lines. On a two-line invoice where regex caught the first, Claude's complete
set was discarded and the second line — its mass, its emissions — never reached
the declaration. Nothing flagged the omission, so the reviewer confirmed a
short declaration that looked complete.

The merge is now a union. Deterministic lines are never modified, which is the
invariant the module is built on; validated Claude lines the deterministic layer
missed are added alongside, and every addition is flagged so the reviewer sees
that the two extractors disagreed about how many lines the document had.

N2: the origin regex matched only the phrase "origin country". Commercial
invoices and customs Box 34 say "country of origin", which returned null. Origin
country decides CBAM scope and the electricity factor.
"""
from __future__ import annotations

import pytest

from ledger_app.services.cbam_extraction._extractor import ClaudeCBAMExtractor

pytestmark = pytest.mark.regulatory

TWO_LINE_TEXT = """COMMERCIAL INVOICE

Line 1
  CN code: 72071111
  Net mass: 24500 kg

Line 2
  CN code: 72085100
  Net mass: 18000 kg
"""

CLAUDE_BOTH_LINES = {
    "lines": [
        {"cn_code": "72071111", "net_mass_kg": 24500},
        {"cn_code": "72085100", "net_mass_kg": 18000},
    ]
}


def _merge(payload, claude_json, raw_text):
    flags: list[dict] = []
    evidence: list[dict] = []
    ClaudeCBAMExtractor()._merge_claude_lines(
        payload, claude_json, evidence, raw_text, flags, None
    )
    return payload, flags


class TestLineUnion:
    def test_missed_line_is_added_not_discarded(self):
        payload = {"lines": [{"cn_code": "72071111", "net_mass_kg": 24500.0}]}
        payload, _ = _merge(payload, CLAUDE_BOTH_LINES, TWO_LINE_TEXT)

        codes = [line["cn_code"] for line in payload["lines"]]
        assert codes == ["72071111", "72085100"]

    def test_the_deterministic_line_is_left_untouched(self):
        original = {"cn_code": "72071111", "net_mass_kg": 24500.0, "description": "kept"}
        payload = {"lines": [dict(original)]}
        payload, _ = _merge(payload, CLAUDE_BOTH_LINES, TWO_LINE_TEXT)

        assert payload["lines"][0] == original

    def test_adding_a_line_is_flagged(self):
        payload = {"lines": [{"cn_code": "72071111", "net_mass_kg": 24500.0}]}
        _, flags = _merge(payload, CLAUDE_BOTH_LINES, TWO_LINE_TEXT)

        assert any(f["issue"] == "claude_line_added_beyond_deterministic" for f in flags)

    def test_a_duplicate_line_is_not_added_twice(self):
        payload = {"lines": [
            {"cn_code": "72071111", "net_mass_kg": 24500.0},
            {"cn_code": "72085100", "net_mass_kg": 18000.0},
        ]}
        payload, _ = _merge(payload, CLAUDE_BOTH_LINES, TWO_LINE_TEXT)

        assert len(payload["lines"]) == 2

    def test_same_cn_code_with_a_different_mass_is_added_and_flagged(self):
        """Either a second consignment of the same product or the two extractors
        disagreeing. Both need a human, so it is added and flagged rather than
        silently dropped or silently merged."""
        payload = {"lines": [{"cn_code": "72071111", "net_mass_kg": 24500.0}]}
        claude = {"lines": [{"cn_code": "72071111", "net_mass_kg": 18000}]}
        payload, flags = _merge(payload, claude, TWO_LINE_TEXT)

        assert len(payload["lines"]) == 2
        assert any(f["issue"] == "claude_line_same_cn_different_mass" for f in flags)

    def test_still_populates_when_deterministic_found_nothing(self):
        payload: dict = {}
        payload, _ = _merge(payload, CLAUDE_BOTH_LINES, TWO_LINE_TEXT)
        assert len(payload["lines"]) == 2

    def test_an_unevidenced_line_is_still_rejected(self):
        """The union must not weaken the anti-hallucination checks."""
        payload = {"lines": [{"cn_code": "72071111", "net_mass_kg": 24500.0}]}
        claude = {"lines": [{"cn_code": "76011000", "net_mass_kg": 99999}]}
        payload, flags = _merge(payload, claude, TWO_LINE_TEXT)

        assert len(payload["lines"]) == 1
        assert any("not_evidenced" in f["issue"] for f in flags)

    def test_a_line_count_disagreement_is_flagged_even_when_nothing_is_added(self):
        payload = {"lines": [
            {"cn_code": "72071111", "net_mass_kg": 24500.0},
            {"cn_code": "72085100", "net_mass_kg": 18000.0},
        ]}
        claude = {"lines": [{"cn_code": "72071111", "net_mass_kg": 24500}]}
        _, flags = _merge(payload, claude, TWO_LINE_TEXT)

        assert any(f["issue"] == "line_count_disagreement" for f in flags)


class TestOriginCountry:
    @pytest.mark.parametrize(
        "phrasing",
        [
            "Country of origin: TR",
            "country of origin - TR",
            "Origin country: TR",
            "COUNTRY OF ORIGIN  TR",
            "Origin Country TR",
        ],
    )
    def test_every_common_phrasing_is_read(self, phrasing):
        from ledger_app.services import text_ingest as ti

        original = ti._specialist_candidates
        ti._specialist_candidates = lambda t: ([], None, [], [], False)
        try:
            result = ti.run_text_ingest(
                f"COMMERCIAL INVOICE\nCN code: 72071111\nNet mass: 24500 kg\n{phrasing}\n"
            )
        finally:
            ti._specialist_candidates = original

        assert result["candidate"]["invoice"]["origin_country"] == "TR"

    def test_a_country_name_is_not_mistaken_for_a_code(self):
        from ledger_app.services import text_ingest as ti

        original = ti._specialist_candidates
        ti._specialist_candidates = lambda t: ([], None, [], [], False)
        try:
            result = ti.run_text_ingest(
                "COMMERCIAL INVOICE\nCN code: 72071111\nCountry of origin: Turkey\n"
            )
        finally:
            ti._specialist_candidates = original

        # Two letters of "Turkey" must not become the ISO code "TU".
        assert result["candidate"]["invoice"]["origin_country"] is None
