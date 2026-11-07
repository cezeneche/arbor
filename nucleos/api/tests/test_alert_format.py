"""Nucleos renders Slack alerts exactly as Arbor does: both are checked against
contract/alerts/golden.json, so a message looks the same whichever system sends it."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

from ledger_app.services.alert_format import Alert, render_slack

GOLDEN = json.loads(
    (Path(__file__).resolve().parents[3] / "contract" / "alerts" / "golden.json").read_text("utf-8")
)


def _alert(raw: dict) -> Alert:
    link = raw.get("link")
    return Alert(
        severity=raw["severity"],
        source=raw["source"],
        environment=raw["environment"],
        title=raw["title"],
        summary=raw["summary"],
        at=datetime.fromisoformat(raw["at"].replace("Z", "+00:00")),
        facts=[(f["label"], f["value"]) for f in raw.get("facts", [])],
        action=raw.get("action"),
        link=(link["label"], link["url"]) if link else None,
        ref=raw.get("ref"),
    )


@pytest.mark.parametrize("case", GOLDEN, ids=[c["name"] for c in GOLDEN])
def test_slack_matches_golden(case):
    assert render_slack(_alert(case["alert"])) == case["slack"]


def _base(**over) -> Alert:
    fields = dict(
        severity="warning",
        source="Nucleos",
        environment="production",
        title="Something",
        summary="Something happened.",
        at=datetime.fromisoformat("2026-10-17T14:03:00+00:00"),
    )
    fields.update(over)
    return Alert(**fields)


def test_at_most_ten_facts():
    # Slack rejects a section with more than ten fields, losing the whole message.
    facts = [(f"L{i}", f"v{i}") for i in range(12)]
    fields = next(b for b in render_slack(_base(facts=facts))["blocks"] if "fields" in b)["fields"]
    assert len(fields) == 10


@pytest.mark.parametrize(
    "url,kept",
    [("https://arbor.example/x", True), ("http://localhost:3000/x", True), ("mailto:a@b.c", False), ("/relative", False)],
)
def test_only_http_links_become_buttons(url, kept):
    blocks = render_slack(_base(link=("Open", url)))["blocks"]
    assert any(b["type"] == "actions" for b in blocks) is kept
