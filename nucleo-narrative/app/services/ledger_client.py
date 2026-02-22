import httpx
from app.core.config import settings

def fetch_report_package(case_id: str) -> dict:
    base = settings.nucleo_ledger_url.rstrip("/")
    url = f"{base}/api/cases/{case_id}/report-package"
    with httpx.Client(timeout=60.0) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.json()
