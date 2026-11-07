"""Every Slack message Nucleos sends is built in the shared house style
(contract/alerts/README.md): plain-English title, a short summary, facts, one
button to the case, and no customer figures."""
from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from ledger_app.services.slack_notifier import _build_message

ARBOR = {"BASE_URL": "https://arbor.example", "VERCEL_ENV": "production"}


def _blocks_text(payload: dict) -> str:
    return json.dumps(payload["blocks"], ensure_ascii=False)


def _button(payload: dict) -> dict | None:
    actions = [b for b in payload["blocks"] if b["type"] == "actions"]
    return actions[0]["elements"][0] if actions else None


def _facts(payload: dict) -> list[str]:
    section = next((b for b in payload["blocks"] if "fields" in b), None)
    return [f["text"] for f in section["fields"]] if section else []


class TestReviewRequired:
    """The data-quality gate stopped a report: names what is missing, links to the case."""

    def _payload(self, **data):
        event = {"risk_tier": "blocking", "score": 40, "blocking_issues": ["commodity_code", "installation_id"], "run_id": "run-9"}
        event.update(data)
        with patch.dict(os.environ, ARBOR):
            return _build_message("case-001", "human_review_required", event)

    def test_house_style(self):
        payload = self._payload()
        assert payload["text"] == "Warning: A CBAM report was stopped for missing data"
        assert payload["blocks"][0]["elements"][0]["text"] == ":large_orange_circle: *Warning* · Nucleos · production"
        assert "attachments" not in payload

    def test_lists_the_missing_fields_and_links_to_the_case(self):
        payload = self._payload()
        assert "*Missing fields*\ncommodity_code, installation_id" in _facts(payload)
        assert _button(payload) == {
            "type": "button",
            "text": {"type": "plain_text", "text": "Open the case", "emoji": False},
            "url": "https://arbor.example/cbam/case-001",
            "style": "primary",
        }
        assert "ref `run-9`" in _blocks_text(payload)

    def test_never_calls_the_data_quality_level_a_tier(self):
        # "Tier" belongs to Arbor's provenance axis only (nucleos/CLAUDE.md).
        assert "tier" not in _blocks_text(self._payload()).lower()

    def test_leaves_out_what_it_does_not_have(self):
        payload = self._payload(blocking_issues=[], score=None, run_id=None)
        assert _facts(payload) == ["*Case*\ncase-001"]
        assert "—" not in _blocks_text(payload)


class TestPipelineError:
    def _payload(self, **data):
        event = {"stage": "calculation", "error": "ValueError: no emissions factor\nTraceback (most recent call last): ...", "run_id": "case-002"}
        event.update(data)
        with patch.dict(os.environ, ARBOR):
            return _build_message("case-002", "pipeline_error", event)

    def test_house_style(self):
        payload = self._payload()
        assert payload["text"] == "Action needed: The CBAM calculation failed"
        assert _button(payload)["url"] == "https://arbor.example/cbam/case-002"

    def test_shows_only_the_first_line_of_the_error(self):
        # A traceback in Slack is unreadable; the full one is in the logs and Sentry.
        facts = _facts(self._payload())
        assert "*Error*\nValueError: no emissions factor" in facts
        assert "Traceback" not in _blocks_text(self._payload())

    def test_names_the_file_when_known(self):
        assert "*File*\ninvoice.pdf" in _facts(self._payload(filename="invoice.pdf"))

    def test_unknown_case_has_no_button(self):
        with patch.dict(os.environ, ARBOR):
            payload = _build_message("unknown", "pipeline_error", {"stage": "ingestion", "error": "boom"})
        assert payload["text"] == "Action needed: CBAM ingestion failed"
        assert _button(payload) is None


def test_other_events_are_a_plain_update():
    with patch.dict(os.environ, ARBOR):
        payload = _build_message("case-003", "eu_xml_generated", {"goods_line_count": 4})
    assert payload["text"] == "Update: EU XML generated on a CBAM case"
    assert _button(payload)["url"] == "https://arbor.example/cbam/case-003"


def test_no_button_without_base_url():
    with patch.dict(os.environ, {"BASE_URL": ""}):
        assert _button(_build_message("case-004", "eu_xml_generated", {})) is None


@pytest.mark.parametrize("event_type", ["human_review_required", "pipeline_error", "eu_xml_generated"])
def test_outside_text_is_escaped(event_type):
    with patch.dict(os.environ, ARBOR):
        payload = _build_message("<!channel>", event_type, {"error": "<!here>", "blocking_issues": ["<@U1>"]})
    text = _blocks_text(payload)
    assert "<!channel>" not in text and "<!here>" not in text and "<@U1>" not in text
