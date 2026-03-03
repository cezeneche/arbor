"""Tests for ClaudeCBAMExtractor — Task #3: Replace MockLLM with real model.

Coverage:
- Claude API called when ANTHROPIC_API_KEY is set (_call_claude invoked)
- Response parsed into correct output structure (extractor field, lines, header)
- Evidence chain populated from Claude response
- Line items from Claude JSON merged when regex finds none
- Graceful fallback to regex-only when ANTHROPIC_API_KEY is absent
- Graceful fallback when _call_claude raises an exception
- _EXTRACTOR singleton is now ClaudeCBAMExtractor
- Prompt contains all required CBAM fields
- Model selection via env var and constructor
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import ledger_app.services.cbam_extractor as cbam_extractor
from ledger_app.services.cbam_extractor import ClaudeCBAMExtractor


# ── Helpers ───────────────────────────────────────────────────────────────────

def _invoice_text(
    cn_code: str = "72081000",
    origin: str = "TR",
    mass: int = 10000,
) -> str:
    return (
        f"Invoice Number: INV-CLAUDE-001\n"
        f"Invoice Date: 2025-03-15\n"
        f"Importer: Alpha Steel GmbH\n"
        f"EORI: DE123456789012\n"
        f"Origin Country: {origin}\n"
        f"Incoterm: CIF\n"
        f"CN code: {cn_code}\n"
        f"Net mass kg: {mass}\n"
        f"Calculation Method: actual\n"
        f"Direct Embedded Emissions (kgCO2e): 21760\n"
        f"Indirect Embedded Emissions (kgCO2e): 540\n"
    )


def _claude_json_str(
    cn_code: str = "72081000",
    origin: str = "TR",
    mass: int = 10000,
) -> str:
    return json.dumps(
        {
            "importer_name": "Alpha Steel GmbH",
            "importer_eori": "DE123456789012",
            "invoice_number": "INV-CLAUDE-001",
            "invoice_date": "2025-03-15",
            "origin_country": origin,
            "incoterm": "CIF",
            "entry_reference": None,
            "lines": [
                {
                    "cn_code": cn_code,
                    "description": "Hot rolled flat steel",
                    "net_mass_kg": mass,
                    "direct_embedded_kgco2e": 21760,
                    "indirect_embedded_kgco2e": 540,
                    "method": "actual",
                }
            ],
        }
    )


# ── _EXTRACTOR singleton ──────────────────────────────────────────────────────

class TestExtractorSingleton:
    def test_default_extractor_is_claude(self):
        assert isinstance(cbam_extractor._EXTRACTOR, ClaudeCBAMExtractor)

    def test_extractor_has_model_attribute(self):
        assert hasattr(cbam_extractor._EXTRACTOR, "model")
        assert isinstance(cbam_extractor._EXTRACTOR.model, str)


# ── Regex fallback (no API key) ───────────────────────────────────────────────

class TestRegexFallback:
    def test_fallback_when_no_api_key(self, tmp_path: Path, monkeypatch):
        sample = tmp_path / "invoice.txt"
        sample.write_text(_invoice_text(), encoding="utf-8")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        extractor = ClaudeCBAMExtractor()
        result = extractor.extract(str(sample))

        assert result.get("extractor") == "regex"
        assert result.get("fallback") == "regex_only"
        assert result.get("status") == "parsed"

    def test_fallback_extracts_fields_from_raw_text(self, tmp_path: Path, monkeypatch):
        sample = tmp_path / "invoice.txt"
        sample.write_text(_invoice_text(cn_code="72081000"), encoding="utf-8")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        extractor = ClaudeCBAMExtractor()
        result = extractor.extract(str(sample))

        # Regex should extract the CN code from raw text
        cn_from_structured = result.get("structured", {}).get("cn_code")
        cn_from_lines = next(
            (line.get("cn_code") for line in (result.get("lines") or [])), None
        )
        assert cn_from_structured is not None or cn_from_lines is not None

    def test_fallback_on_call_exception(self, tmp_path: Path, monkeypatch):
        """Falls back to regex when _call_claude raises."""
        sample = tmp_path / "invoice.txt"
        sample.write_text(_invoice_text(), encoding="utf-8")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        extractor = ClaudeCBAMExtractor()

        def _raise(text: str) -> str:
            raise RuntimeError("API unavailable")

        monkeypatch.setattr(extractor, "_call_claude", _raise)
        result = extractor.extract(str(sample))

        assert result.get("extractor") == "regex"
        assert result.get("fallback") == "regex_only"

    def test_missing_file_returns_error(self, tmp_path: Path, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        extractor = ClaudeCBAMExtractor()
        result = extractor.extract(str(tmp_path / "nonexistent.txt"))
        assert result["status"] == "error"


# ── Claude API path ───────────────────────────────────────────────────────────

class TestClaudeAPIPath:
    """Tests that patch _call_claude to avoid live network calls."""

    def test_extractor_field_includes_model_name(self, tmp_path: Path, monkeypatch):
        sample = tmp_path / "invoice.txt"
        sample.write_text(_invoice_text(), encoding="utf-8")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        extractor = ClaudeCBAMExtractor(model="claude-haiku-4-5-20251001")
        monkeypatch.setattr(extractor, "_call_claude", lambda _: _claude_json_str())
        result = extractor.extract(str(sample))

        assert result.get("extractor") == "claude:claude-haiku-4-5-20251001"

    def test_invoice_header_fields_extracted(self, tmp_path: Path, monkeypatch):
        sample = tmp_path / "invoice.txt"
        sample.write_text(_invoice_text(), encoding="utf-8")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        extractor = ClaudeCBAMExtractor()
        monkeypatch.setattr(extractor, "_call_claude", lambda _: _claude_json_str())
        result = extractor.extract(str(sample))

        invoice = result.get("invoice", {})
        assert invoice.get("invoice_number") == "INV-CLAUDE-001"
        assert invoice.get("origin_country") == "TR"

    def test_importer_details_extracted(self, tmp_path: Path, monkeypatch):
        sample = tmp_path / "invoice.txt"
        sample.write_text(_invoice_text(), encoding="utf-8")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        extractor = ClaudeCBAMExtractor()
        monkeypatch.setattr(extractor, "_call_claude", lambda _: _claude_json_str())
        result = extractor.extract(str(sample))

        importer = result.get("importer", {})
        assert importer.get("name") == "Alpha Steel GmbH"
        assert importer.get("eori") == "DE123456789012"

    def test_claude_lines_merged_when_regex_finds_none(
        self, tmp_path: Path, monkeypatch
    ):
        # Document has no "Line N: ..." patterns so regex extracts no lines.
        # CN code and mass must appear in the document for evidence checks to pass.
        sample = tmp_path / "invoice.txt"
        sample.write_text(
            "Invoice Number: INV-NOLINE-001\nOrigin Country: CN\n"
            "CN code: 72081000\nNet mass kg: 5000\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        extractor = ClaudeCBAMExtractor()
        monkeypatch.setattr(
            extractor,
            "_call_claude",
            lambda _: _claude_json_str(cn_code="72081000", mass=5000),
        )
        result = extractor.extract(str(sample))

        lines = result.get("lines", [])
        assert len(lines) >= 1
        assert lines[0]["cn_code"] == "72081000"
        assert lines[0]["net_mass_kg"] == 5000.0

    def test_regex_lines_not_overwritten_by_claude(
        self, tmp_path: Path, monkeypatch
    ):
        # Document has regex-parseable "Line N:" patterns.
        sample = tmp_path / "invoice.txt"
        sample.write_text(
            "Line 1: 72081000 | Hot rolled steel | 10000 kg | net mass kg 10000\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        # Claude returns a different CN code — regex result should win.
        extractor = ClaudeCBAMExtractor()
        monkeypatch.setattr(
            extractor,
            "_call_claude",
            lambda _: _claude_json_str(cn_code="25232900"),
        )
        result = extractor.extract(str(sample))

        cn_codes = {line["cn_code"] for line in result.get("lines", [])}
        assert "72081000" in cn_codes
        assert "25232900" not in cn_codes

    def test_evidence_chain_populated(self, tmp_path: Path, monkeypatch):
        sample = tmp_path / "invoice.txt"
        sample.write_text(_invoice_text(), encoding="utf-8")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        extractor = ClaudeCBAMExtractor()
        monkeypatch.setattr(extractor, "_call_claude", lambda _: _claude_json_str())
        result = extractor.extract(str(sample))

        evidence = result.get("evidence", [])
        assert isinstance(evidence, list)
        fields = {atom.get("field") for atom in evidence if isinstance(atom, dict)}
        assert len(fields) > 0

    def test_malformed_json_still_uses_regex_fallback_in_parse(
        self, tmp_path: Path, monkeypatch
    ):
        """_parse_structured_response regex fallback handles non-JSON responses."""
        sample = tmp_path / "invoice.txt"
        sample.write_text(_invoice_text(), encoding="utf-8")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        extractor = ClaudeCBAMExtractor()
        monkeypatch.setattr(
            extractor, "_call_claude", lambda _: "Sorry, cannot process this."
        )
        result = extractor.extract(str(sample))

        # _parse_structured_response uses regex fallbacks when JSON parsing fails,
        # so the overall extraction still completes.
        assert isinstance(result, dict)
        assert result.get("status") == "parsed"

    def test_multi_line_document_merges_all_claude_lines(
        self, tmp_path: Path, monkeypatch
    ):
        """Multiple Claude line items are all merged when regex finds nothing."""
        # CN codes and masses must appear in text for evidence checks to pass.
        # Codes are embedded as "HS72081000" so the \b\d{6,8}\b fallback in
        # _parse_structured_response does NOT pick them up as standalone cn_code
        # values (no word boundary before the digit run), keeping det lines empty.
        sample = tmp_path / "invoice.txt"
        sample.write_text(
            "No line patterns here.\nHS72081000 M1000kg\nHS72193100 M500kg\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        multi_response = json.dumps(
            {
                "importer_name": None,
                "importer_eori": None,
                "invoice_number": None,
                "invoice_date": None,
                "origin_country": "DE",
                "incoterm": None,
                "entry_reference": None,
                "lines": [
                    {"cn_code": "72081000", "description": "Steel A", "net_mass_kg": 1000,
                     "direct_embedded_kgco2e": None, "indirect_embedded_kgco2e": None, "method": "default"},
                    {"cn_code": "72193100", "description": "Stainless", "net_mass_kg": 500,
                     "direct_embedded_kgco2e": None, "indirect_embedded_kgco2e": None, "method": "actual"},
                ],
            }
        )

        extractor = ClaudeCBAMExtractor()
        monkeypatch.setattr(extractor, "_call_claude", lambda _: multi_response)
        result = extractor.extract(str(sample))

        lines = result.get("lines", [])
        assert len(lines) == 2
        cn_codes = {line["cn_code"] for line in lines}
        assert "72081000" in cn_codes
        assert "72193100" in cn_codes


# ── _call_claude unit tests ───────────────────────────────────────────────────

class TestCallClaude:
    def test_call_claude_sends_document_text_in_prompt(self, monkeypatch):
        """_call_claude includes the document text in the API request."""
        captured_kwargs: dict[str, Any] = {}

        class _FakeContent:
            text = '{"lines": []}'

        class _FakeMessage:
            content = [_FakeContent()]

        class _FakeMessages:
            def create(self, **kwargs: Any) -> _FakeMessage:
                captured_kwargs.update(kwargs)
                return _FakeMessage()

        class _FakeClient:
            messages = _FakeMessages()

        import anthropic as _real_anthropic
        monkeypatch.setattr(_real_anthropic, "Anthropic", lambda: _FakeClient())
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

        extractor = ClaudeCBAMExtractor()
        result = extractor._call_claude("test document text")

        assert "model" in captured_kwargs
        assert captured_kwargs["model"] == extractor.model
        user_content = captured_kwargs["messages"][0]["content"]
        assert "test document text" in user_content

    def test_call_claude_truncates_long_documents(self, monkeypatch):
        """_call_claude sends at most 8000 chars of document text."""
        captured_content: list[str] = []

        class _FakeContent:
            text = '{"lines": []}'

        class _FakeMessage:
            content = [_FakeContent()]

        class _FakeMessages:
            def create(self, **kwargs: Any) -> _FakeMessage:
                captured_content.append(kwargs["messages"][0]["content"])
                return _FakeMessage()

        class _FakeClient:
            messages = _FakeMessages()

        import anthropic as _real_anthropic
        monkeypatch.setattr(_real_anthropic, "Anthropic", lambda: _FakeClient())

        extractor = ClaudeCBAMExtractor()
        long_text = "x" * 20_000
        extractor._call_claude(long_text)

        sent = captured_content[0]
        # The prompt wraps the document; the document portion is capped at 8000 chars
        assert len(sent) <= len(ClaudeCBAMExtractor._PROMPT) + 8100


# ── Model configuration ────────────────────────────────────────────────────────

class TestModelConfiguration:
    def test_default_model_is_haiku(self, monkeypatch):
        monkeypatch.delenv("CBAM_EXTRACTOR_MODEL", raising=False)
        extractor = ClaudeCBAMExtractor()
        assert extractor.model == "claude-haiku-4-5-20251001"

    def test_model_overridden_by_env_var(self, monkeypatch):
        monkeypatch.setenv("CBAM_EXTRACTOR_MODEL", "claude-sonnet-4-6")
        extractor = ClaudeCBAMExtractor()
        assert extractor.model == "claude-sonnet-4-6"

    def test_model_overridden_by_constructor(self, monkeypatch):
        monkeypatch.delenv("CBAM_EXTRACTOR_MODEL", raising=False)
        extractor = ClaudeCBAMExtractor(model="claude-opus-4-6")
        assert extractor.model == "claude-opus-4-6"

    def test_prompt_contains_required_cbam_fields(self):
        for field in (
            "importer_eori",
            "cn_code",
            "net_mass_kg",
            "direct_embedded_kgco2e",
            "indirect_embedded_kgco2e",
            "method",
            "origin_country",
        ):
            assert field in ClaudeCBAMExtractor._PROMPT, f"Prompt missing: {field}"

    def test_prompt_mentions_cbam_context(self):
        assert "CBAM" in ClaudeCBAMExtractor._PROMPT
        assert "CN" in ClaudeCBAMExtractor._PROMPT
        assert "actual" in ClaudeCBAMExtractor._PROMPT
        assert "default" in ClaudeCBAMExtractor._PROMPT
        assert "estimated" in ClaudeCBAMExtractor._PROMPT


# ── Public extract() wrapper unchanged ────────────────────────────────────────

class TestPublicExtractWrapper:
    def test_extract_function_delegates_to_extractor(
        self, tmp_path: Path, monkeypatch
    ):
        sample = tmp_path / "invoice.txt"
        sample.write_text("CN code: 72081000\n", encoding="utf-8")

        class _Stub:
            def extract(self, fp: str, **_kw: Any) -> dict:
                return {"status": "parsed", "stub": True}

        monkeypatch.setattr(cbam_extractor, "_EXTRACTOR", _Stub())
        result = cbam_extractor.extract(str(sample))
        assert result == {"status": "parsed", "stub": True}
