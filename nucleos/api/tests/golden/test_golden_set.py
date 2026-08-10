"""The golden set — frozen input/output pairs for the CBAM domain logic.

The integration plan moves this engine behind an HTTP boundary, takes document
handling away from it, and rewrites the code around it. None of that is allowed
to change what the engine computes. The golden set is the evidence: it runs the
real code on fixed inputs and compares against committed results.

It must pass unchanged after every phase. When it fails, the default assumption
is that the change is wrong — not the golden file.

Regenerating
------------
    GOLDEN_UPDATE=1 pytest api/tests/golden

Regeneration is a deliberate act with a paper trail: the rewritten JSON goes in
the diff and has to be read and justified in review. Running it to make a red
suite green is the one way this file stops being worth anything.

Every case records the engine and table versions in force when it was frozen,
so a value that moved because a regulatory table was deliberately re-versioned
is distinguishable from one that moved because someone broke it.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from .adapters import run_case
from .versions import current_versions

GOLDEN_DIR = Path(__file__).resolve().parents[3] / "golden" / "cases"
UPDATE = os.getenv("GOLDEN_UPDATE") == "1"

pytestmark = pytest.mark.golden


def _case_files() -> list[Path]:
    return sorted(GOLDEN_DIR.rglob("*.json"))


def _case_id(path: Path) -> str:
    return str(path.relative_to(GOLDEN_DIR).with_suffix(""))


CASE_FILES = _case_files()


def test_the_golden_set_is_not_empty():
    """A golden suite that silently covers nothing passes just as green as one
    that covers everything."""
    assert CASE_FILES, f"No golden cases found under {GOLDEN_DIR}"


@pytest.mark.parametrize("path", CASE_FILES, ids=[_case_id(p) for p in CASE_FILES])
def test_golden_case(path: Path):
    case = json.loads(path.read_text(encoding="utf-8"))

    for required in ("name", "why", "adapter", "input"):
        assert required in case, f"{path.name} is missing {required!r}"

    actual = run_case(case["adapter"], case["input"])

    if UPDATE:
        case["expected"] = actual
        case["versions"] = current_versions()
        path.write_text(json.dumps(case, indent=2, sort_keys=False) + "\n", encoding="utf-8")
        pytest.skip(f"regenerated {path.name}")

    assert "expected" in case, (
        f"{path.name} has no expected result. Generate it with GOLDEN_UPDATE=1 "
        f"and review the output before committing."
    )

    assert actual == case["expected"], (
        f"{case['name']} changed.\n"
        f"This case exists because: {case['why']}\n"
        f"Frozen under versions: {case.get('versions')}\n"
        f"Current versions:      {current_versions()}\n"
        f"If this change is intended, say so explicitly and regenerate with "
        f"GOLDEN_UPDATE=1."
    )


@pytest.mark.parametrize("path", CASE_FILES, ids=[_case_id(p) for p in CASE_FILES])
def test_golden_case_records_the_versions_it_was_frozen_under(path: Path):
    if UPDATE:
        pytest.skip("regenerating")
    case = json.loads(path.read_text(encoding="utf-8"))
    assert case.get("versions"), (
        f"{path.name} has no version stamp — a value that moves cannot be "
        f"attributed to a deliberate table change without one."
    )


def test_every_adapter_is_exercised():
    """An adapter with no case is untested plumbing that reads as coverage."""
    from .adapters import ADAPTERS

    used = {
        json.loads(p.read_text(encoding="utf-8"))["adapter"]
        for p in CASE_FILES
    }
    unused = set(ADAPTERS) - used
    assert not unused, f"Adapters with no golden case: {sorted(unused)}"
