#!/usr/bin/env python3
"""Gate a pytest JUnit report: no unexpected failures, errors or skips.

pytest exits 0 over a suite that skipped everything needing Postgres, so its
exit code is not a release gate. This reads the report instead:

  - any failure or error not listed in KNOWN_FAILURES fails the build;
  - a listed failure that now passes fails the build too, so the list cannot
    quietly outlive the problem it records;
  - any skip not listed in ALLOWED_SKIPS fails the build.

Every entry names the open decision that owns it. The list is a record of
debt with owners, not a way to make a red suite green — the tests still run
and still fail in the log.

Usage: check-pytest-report.py report.xml
"""
import sys
import xml.etree.ElementTree as ET

# Empty. Add an entry only with the open decision that owns it.
KNOWN_FAILURES: set[str] = set()

ALLOWED_SKIPS = {
    # Live-model test: needs ANTHROPIC_API_KEY, which CI does not hold. Reported
    # separately; its absence is not a release approval.
    "api.tests.test_full_pipeline.TestHappyPathSteelActual::test_narrative_pipeline_endpoint_returns_200",
}


def main(path: str) -> int:
    root = ET.parse(path).getroot()
    failed, skipped, passed = set(), set(), set()
    for case in root.iter("testcase"):
        name = f"{case.get('classname')}::{case.get('name')}"
        if case.find("failure") is not None or case.find("error") is not None:
            failed.add(name)
        elif case.find("skipped") is not None:
            skipped.add(name)
        else:
            passed.add(name)

    problems = []
    for name in sorted(failed - KNOWN_FAILURES):
        problems.append(f"FAILED (not a known failure): {name}")
    for name in sorted(KNOWN_FAILURES & passed):
        problems.append(f"PASSED but listed as a known failure — remove it from KNOWN_FAILURES: {name}")
    for name in sorted(skipped - ALLOWED_SKIPS):
        problems.append(f"SKIPPED (not an allowed skip): {name}")

    total = len(failed) + len(skipped) + len(passed)
    print(f"{total} tests: {len(passed)} passed, {len(failed)} failed, {len(skipped)} skipped")
    for name in sorted(failed & KNOWN_FAILURES):
        print(f"  known failure, owner decision open: {name}")
    for name in sorted(skipped & ALLOWED_SKIPS):
        print(f"  allowed skip (live model): {name}")
    if problems:
        print("\n".join(problems))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
