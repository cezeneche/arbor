"""The registration scheduler is off unless switched on.

It tracks the UK £50,000-in-12-months threshold, which no Arbor screen shows
yet and which starts to matter from January 2027. Running it on every instance
until then is work nobody reads (docs/audits/2026-09-27-nucleos-endpoints.md,
section 6). It is switched on with CBAM_REGISTRATION_SCHEDULER=true.
"""
from __future__ import annotations

from ledger_app.core.config import AppConfig


def test_off_by_default(monkeypatch):
    monkeypatch.delenv("CBAM_REGISTRATION_SCHEDULER", raising=False)
    assert AppConfig.registration_scheduler_enabled() is False


def test_on_when_asked_for(monkeypatch):
    monkeypatch.setenv("CBAM_REGISTRATION_SCHEDULER", "true")
    assert AppConfig.registration_scheduler_enabled() is True


def test_off_when_switched_off(monkeypatch):
    monkeypatch.setenv("CBAM_REGISTRATION_SCHEDULER", "false")
    assert AppConfig.registration_scheduler_enabled() is False
