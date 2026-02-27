import httpx
from app.core.config import settings

def _fetch_json(url: str) -> dict:
    with httpx.Client(timeout=60.0) as client:
        response = client.get(url)
        if response.status_code >= 400:
            raise RuntimeError(
                f"Ledger request failed: status={response.status_code}, body={response.text}"
            )
        return response.json()

def fetch_report_package(case_id: str) -> dict:
    base = settings.ledger_base_url.rstrip("/")
    url = f"{base}/api/cases/{case_id}/report-package"
    return _fetch_json(url)


def fetch_cbam_report_package(case_id: str) -> dict:
    base = settings.ledger_base_url.rstrip("/")
    url = f"{base}/api/cbam/cases/{case_id}/report-package"
    return _fetch_json(url)
