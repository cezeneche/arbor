"""E4: every Anthropic client in Nucleos names its timeout and its retries.

The SDK's default is ten minutes per attempt with two retries. The CBAM
classifier set no timeout at all, and the audit narrative's 60 s timeout was
retried twice by default: up to three minutes, while Arbor's narrative route
(src/app/api/cbam/cases/[caseId]/narrative/route.ts) gives up at 120 s and so
stopped waiting before Nucleos had failed.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

API = Path(__file__).resolve().parents[1]
ARBOR_NARRATIVE_ROUTE = API.parents[1] / "src" / "app" / "api" / "cbam" / "cases" / "[caseId]" / "narrative" / "route.ts"


def _anthropic_clients() -> list[tuple[str, ast.Call]]:
    found = []
    for path in API.rglob("*.py"):
        if "tests" in path.parts or ".venv" in path.parts:
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "Anthropic"
            ):
                found.append((str(path.relative_to(API)), node))
    return found


def test_every_client_names_its_timeout_and_retries():
    clients = _anthropic_clients()
    assert clients, "expected to find the Anthropic clients"
    missing = [
        f"{where}:{call.lineno}"
        for where, call in clients
        if not {"timeout", "max_retries"} <= {k.arg for k in call.keywords}
    ]
    assert missing == []


def test_the_narrative_fails_before_arbor_stops_waiting():
    from app.services import narrative

    arbor_limit = int(re.search(r"export const maxDuration = (\d+)", ARBOR_NARRATIVE_ROUTE.read_text()).group(1))
    worst = narrative.NARRATIVE_TIMEOUT_SECONDS * (narrative.NARRATIVE_MAX_RETRIES + 1)
    assert worst < arbor_limit
