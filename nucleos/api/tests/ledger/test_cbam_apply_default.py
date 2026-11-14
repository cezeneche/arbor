"""Recording the published default on a goods line (Arbor's "Use the published
default" action), through POST /api/cbam/emissions.

The endpoint already records a default when asked for method "default" with no
figures. Two things were unsafe for a button: with no Annex VI default for the
code it recorded zeros, and a repeated version came back as "invalid emissions
method". These pin the opt-in refusal, the 409, and the audit event.
"""
from __future__ import annotations

import os
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "sqlite:///./cbam_test.db")

from sqlalchemy.exc import IntegrityError

from ledger_app.api.cbam import _shared
from ledger_app.testing import _client_with_fake_engine


def _goods_line(client, cn_code: str = "72083900", net_mass_kg: int = 24500) -> tuple[str, str]:
    case_id = client.post(
        "/api/cbam/cases",
        json={"importer_eori": "GB123456789", "reporting_year": 2026, "reporting_quarter": 3},
    ).json()["id"]
    shipment_id = client.post(
        "/api/cbam/shipments",
        json={"cbam_case_id": case_id, "origin_country": "TR", "customs_procedure": "40"},
    ).json()["id"]
    goods_line_id = client.post(
        "/api/cbam/goods-lines",
        json={"shipment_id": shipment_id, "cn_code": cn_code, "net_mass_kg": net_mass_kg},
    ).json()["id"]
    return case_id, goods_line_id


def _apply_default(client, goods_line_id: str, **extra):
    return client.post(
        "/api/cbam/emissions",
        json={"goods_line_id": goods_line_id, "calculation_method": "default", "version": 1, **extra},
    )


def test_records_the_annex_vi_default_the_calculation_shows():
    # Expected: 49 245 kg direct, 6 615 kg indirect for 24.5 t of 72083900.
    # Reason: the same figures the case page's calculation shows for a UK case
    # (no mark-up), so the button records what the user was looking at.
    client, conn = _client_with_fake_engine()
    _, goods_line_id = _goods_line(client)

    res = _apply_default(client, goods_line_id, require_default_factor=True)

    assert res.status_code == 201, res.text
    stored = next(iter(conn.emissions.values()))
    assert stored["method"] == "default"
    assert Decimal(str(stored["direct_embedded_kgco2e"])) == Decimal("49245")
    assert Decimal(str(stored["indirect_embedded_kgco2e"])) == Decimal("6615")


def _no_published_default(monkeypatch):
    # Every in-scope code in the Annex VI table has a default today, so the
    # missing-default branch is reached by making the lookup find none.
    monkeypatch.setattr(_shared, "compute_see_from_defaults", lambda *_a, **_k: None)


def test_refuses_rather_than_recording_zero_when_asked_to(monkeypatch):
    # Expected: 422 no_published_default, nothing stored. Reason: a zero on the
    # line would understate the return; a refusal says why nothing was recorded.
    client, conn = _client_with_fake_engine()
    _, goods_line_id = _goods_line(client)
    _no_published_default(monkeypatch)

    res = _apply_default(client, goods_line_id, require_default_factor=True)

    assert res.status_code == 422, res.text
    assert res.json()["detail"]["error"] == "no_published_default"
    assert conn.emissions == {}


def test_existing_callers_keep_the_old_behaviour(monkeypatch):
    # Expected: unchanged for callers that do not opt in (zeros plus a warning).
    # Reason: changing what existing callers record is a behavioural change.
    client, _ = _client_with_fake_engine()
    _, goods_line_id = _goods_line(client)
    _no_published_default(monkeypatch)

    res = _apply_default(client, goods_line_id)

    assert res.status_code == 201, res.text
    assert any("no_default_factor" in w for w in res.json()["factor_warnings"])


def test_a_repeated_version_is_a_conflict(monkeypatch):
    # Expected: 409 version_exists. Reason: the unique (goods_line_id, version)
    # constraint is what stops a double click recording two figures, and the
    # caller must be able to tell that from a bad request.
    client, _ = _client_with_fake_engine()
    _, goods_line_id = _goods_line(client)

    def duplicate(*_args, **_kwargs):
        raise IntegrityError(
            "INSERT INTO cbam.cbam_emissions ...",
            {},
            Exception('duplicate key value violates unique constraint "cbam_emissions_unique_version"'),
        )

    monkeypatch.setattr(_shared, "_insert_returning", duplicate)
    res = _apply_default(client, goods_line_id, require_default_factor=True)

    assert res.status_code == 409, res.text
    assert res.json()["detail"]["error"] == "version_exists"


def test_other_integrity_errors_are_unchanged(monkeypatch):
    client, _ = _client_with_fake_engine()
    _, goods_line_id = _goods_line(client)

    def bad_method(*_args, **_kwargs):
        raise IntegrityError(
            "INSERT INTO cbam.cbam_emissions ...",
            {},
            Exception('new row violates check constraint "cbam_emissions_method_check"'),
        )

    monkeypatch.setattr(_shared, "_insert_returning", bad_method)
    res = _apply_default(client, goods_line_id, require_default_factor=True)

    assert res.status_code == 400, res.text
    assert res.json()["detail"]["error"] == "invalid_emissions_method"


def test_recording_emissions_is_on_the_case_audit_trail(monkeypatch):
    # Expected: one emissions_recorded event on the case, naming the line, the
    # method and the version. Reason: a figure that enters a return has to show
    # on the trail, as a supplier's submission already does.
    client, _ = _client_with_fake_engine()
    case_id, goods_line_id = _goods_line(client)
    events: list[tuple] = []
    monkeypatch.setattr(
        _shared,
        "_write_audit_event",
        lambda case, event_type, data, **kw: events.append((case, event_type, data)),
    )

    assert _apply_default(client, goods_line_id, require_default_factor=True).status_code == 201

    assert len(events) == 1
    case, event_type, data = events[0]
    assert case == case_id
    assert event_type == "emissions_recorded"
    assert data["goods_line_id"] == goods_line_id
    assert data["method"] == "default"
    assert data["version"] == 1
