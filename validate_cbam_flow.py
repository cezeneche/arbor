#!/usr/bin/env python3
"""
CBAM integration validation script.

Usage:
1) Start ledger first: ./nucleo-ledger/run.sh
2) Run this script: python validate_cbam_flow.py

Notes:
- Expects ledger at http://127.0.0.1:8000
- Expects at least one sample PDF in nucleo-ledger/test_docs
- Uses /api/auth/token unless LEDGER_TOKEN env var is provided
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import requests

BASE_URL = "http://127.0.0.1:8000"
TEST_DOCS_DIR = Path("nucleo-ledger/test_docs")
TIMEOUT = 20


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def request_json(method: str, path: str, *, headers=None, **kwargs):
    url = f"{BASE_URL}{path}"
    resp = requests.request(method, url, timeout=TIMEOUT, headers=headers, **kwargs)
    if resp.status_code >= 400:
        fail(f"{method} {path} failed ({resp.status_code}): {resp.text}")
    try:
        return resp.json()
    except ValueError:
        fail(f"{method} {path} returned non-JSON response")


def get_token() -> str:
    env_token = os.getenv("LEDGER_TOKEN")
    if env_token:
        return env_token

    try:
        data = request_json("POST", "/api/auth/token")
    except SystemExit:
        fail("Could not mint token at /api/auth/token. Set AUTH_DEV_TOKEN_ENDPOINT=true or provide LEDGER_TOKEN.")
    token = data.get("access_token")
    if not token:
        fail("Token response missing access_token")
    return str(token)


def find_sample_pdf() -> Path:
    if not TEST_DOCS_DIR.exists():
        fail(f"Missing directory: {TEST_DOCS_DIR}")
    pdfs = sorted(TEST_DOCS_DIR.rglob("*.pdf"))
    if not pdfs:
        fail(f"No sample PDF found under {TEST_DOCS_DIR}")
    return pdfs[0]


def main() -> None:
    health = requests.get(f"{BASE_URL}/health", timeout=TIMEOUT)
    if health.status_code != 200:
        fail(f"GET /health failed ({health.status_code}): {health.text}")
    print("✓ Health OK")

    token = get_token()
    auth = {"Authorization": f"Bearer {token}"}

    eori = f"GBVAL{int(time.time())}"
    case_payload = {
        "importer_eori": eori,
        "reporting_year": 2026,
        "reporting_quarter": 1,
    }
    case = request_json("POST", "/api/cbam/cases", headers=auth, json=case_payload)
    case_id = case.get("id")
    if not case_id:
        fail("Case creation response missing id")
    print("✓ Case created")

    pdf_path = find_sample_pdf()
    with pdf_path.open("rb") as f:
        files = {"file": (pdf_path.name, f, "application/pdf")}
        doc = request_json("POST", f"/api/cbam/cases/{case_id}/documents", headers=auth, files=files)
    if not doc.get("document_id"):
        fail("Document upload response missing document_id")
    print("✓ Document uploaded")

    summary = request_json("GET", f"/api/cbam/cases/{case_id}/summary", headers=auth)
    if str(summary.get("case_id")) != str(case_id):
        fail("Summary response case_id mismatch")
    print("✓ Summary generated")

    report = request_json("GET", f"/api/cbam/cases/{case_id}/report-package", headers=auth)
    if report.get("type") != "cbam_report_package_v1":
        fail("Report package response has unexpected type")
    print("✓ Report package generated")

    explain = request_json(
        "GET",
        f"/api/cbam/cases/{case_id}/explain?metric=total_embedded_emissions_kgco2e",
        headers=auth,
    )
    if "total_recomputed" not in explain:
        fail("Explain response missing total_recomputed")
    print("✓ Explain endpoint working")


if __name__ == "__main__":
    main()
