from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from narrative_app.services import ledger_client


class _FakeResponse:
    def __init__(self, status_code: int, json_payload=None, text: str = ""):
        self.status_code = status_code
        self._json_payload = json_payload
        self.text = text

    def json(self):
        if isinstance(self._json_payload, Exception):
            raise self._json_payload
        return self._json_payload


class _FakeClient:
    def __init__(self, steps: list, timeout=None):
        self._steps = list(steps)
        self.timeout = timeout
        self.calls = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get(self, _url: str, headers=None):
        self.calls += 1
        if not self._steps:
            raise AssertionError("No fake response step left")
        step = self._steps.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


@pytest.fixture(autouse=True)
def _ledger_base_url(monkeypatch):
    monkeypatch.setattr(ledger_client.settings, "ledger_base_url", "http://ledger.local", raising=False)


def test_fetch_report_package_retries_5xx_then_succeeds(monkeypatch):
    sleeps: list[float] = []
    fake = _FakeClient(
        steps=[
            _FakeResponse(status_code=500, text="boom-1"),
            _FakeResponse(status_code=503, text="boom-2"),
            _FakeResponse(status_code=200, json_payload={"type": "report_package_v1", "case": {"id": "C1"}}),
        ]
    )

    monkeypatch.setattr(ledger_client.httpx, "Client", lambda timeout=None: fake)
    monkeypatch.setattr(ledger_client.time, "sleep", lambda seconds: sleeps.append(seconds))

    payload = ledger_client.fetch_report_package("C1")
    assert payload["case"]["id"] == "C1"
    assert fake.calls == 3
    assert sleeps == [0.25, 0.5]


def test_fetch_report_package_raises_ledger_down_after_network_errors(monkeypatch):
    request = httpx.Request("GET", "http://ledger.local/api/cases/C1/report-package")
    fake = _FakeClient(
        steps=[
            httpx.ConnectError("conn-1", request=request),
            httpx.ReadTimeout("conn-2", request=request),
            httpx.ConnectError("conn-3", request=request),
        ]
    )

    monkeypatch.setattr(ledger_client.httpx, "Client", lambda timeout=None: fake)
    monkeypatch.setattr(ledger_client.time, "sleep", lambda _seconds: None)

    with pytest.raises(ledger_client.LedgerClientError) as exc_info:
        ledger_client.fetch_report_package("C1")

    err = exc_info.value
    assert err.code == "ledger_down"
    assert "after 3 attempts" in err.message


def test_fetch_report_package_raises_invalid_response_on_non_json(monkeypatch):
    fake = _FakeClient(
        steps=[
            _FakeResponse(status_code=200, json_payload=ValueError("not-json"), text="<html>bad</html>")
        ]
    )

    monkeypatch.setattr(ledger_client.httpx, "Client", lambda timeout=None: fake)

    with pytest.raises(ledger_client.LedgerClientError) as exc_info:
        ledger_client.fetch_report_package("C1")

    err = exc_info.value
    assert err.code == "invalid_response"
    assert "non-JSON" in err.message
