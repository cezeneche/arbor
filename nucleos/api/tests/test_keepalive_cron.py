"""Database keep-alive schedule.

The production database is on Supabase's free tier, which pauses a project after
7 days without activity; the previous project was lost that way. A Vercel cron
must hit a route that queries Postgres at least once a day.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from main import app

VERCEL_JSON = Path(__file__).resolve().parents[2] / "vercel.json"


def _crons() -> list[dict]:
    return json.loads(VERCEL_JSON.read_text()).get("crons", [])


def test_a_daily_cron_hits_the_readiness_route():
    daily = [c for c in _crons() if c["schedule"].split()[2:] == ["*", "*", "*"]]
    assert [c["path"] for c in daily] == ["/ready"]


def test_the_cron_path_answers_a_bare_get_after_querying_the_database():
    # Vercel Cron sends a GET with no bearer token; a route behind the JWT
    # dependency would 401 before reaching the database, so the ping would not
    # count as activity.
    response = TestClient(app).get("/ready")
    assert response.status_code == 200
    assert response.json()["dependencies"]["db"] == "ok"
