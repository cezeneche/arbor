from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
from shared_auth.jwt import create_access_token

from narrative_app.core.config import settings

LEDGER_CONNECT_TIMEOUT_S = 1.5
LEDGER_READ_TIMEOUT_S = 5.0
LEDGER_MAX_RETRIES = 3
LEDGER_RETRY_BACKOFF_BASE_S = 0.25


@dataclass
class LedgerClientError(RuntimeError):
    code: str
    message: str
    url: str
    status_code: int | None = None
    body: str | None = None

    def __str__(self) -> str:
        status = f", status={self.status_code}" if self.status_code is not None else ""
        return f"{self.code}: {self.message}{status}"

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "url": self.url,
        }
        if self.status_code is not None:
            payload["status_code"] = self.status_code
        if self.body is not None:
            payload["body"] = self.body
        return payload


def _trim_body(value: str | None, limit: int = 500) -> str | None:
    if value is None:
        return None
    text = str(value)
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


def _fetch_json(url: str, *, tenant_id: str = "service-tenant", trace_id: str | None = None) -> dict:
    timeout = httpx.Timeout(
        connect=LEDGER_CONNECT_TIMEOUT_S,
        read=LEDGER_READ_TIMEOUT_S,
        write=LEDGER_READ_TIMEOUT_S,
        pool=LEDGER_CONNECT_TIMEOUT_S,
    )
    last_request_error: Exception | None = None

    token, _ = create_access_token(
        sub="narrative-service",
        tenant_id=tenant_id,
        scopes=["cbam:read", "narrative:run"],
    )
    headers = {"Authorization": f"Bearer {token}"}
    if trace_id:
        headers["X-Request-Id"] = trace_id

    with httpx.Client(timeout=timeout) as client:
        for attempt in range(1, LEDGER_MAX_RETRIES + 1):
            try:
                response = client.get(url, headers=headers)
            except httpx.RequestError as exc:
                last_request_error = exc
                if attempt < LEDGER_MAX_RETRIES:
                    time.sleep(LEDGER_RETRY_BACKOFF_BASE_S * (2 ** (attempt - 1)))
                    continue
                raise LedgerClientError(
                    code="ledger_down",
                    message=f"Ledger request failed after {LEDGER_MAX_RETRIES} attempts: {exc}",
                    url=url,
                ) from exc

            if response.status_code >= 500:
                if attempt < LEDGER_MAX_RETRIES:
                    time.sleep(LEDGER_RETRY_BACKOFF_BASE_S * (2 ** (attempt - 1)))
                    continue
                raise LedgerClientError(
                    code="ledger_down",
                    message=f"Ledger returned {response.status_code} after retries",
                    url=url,
                    status_code=response.status_code,
                    body=_trim_body(response.text),
                )

            if response.status_code >= 400:
                raise LedgerClientError(
                    code="invalid_response",
                    message=f"Ledger returned unexpected status {response.status_code}",
                    url=url,
                    status_code=response.status_code,
                    body=_trim_body(response.text),
                )

            try:
                payload = response.json()
            except ValueError as exc:
                raise LedgerClientError(
                    code="invalid_response",
                    message="Ledger returned non-JSON response",
                    url=url,
                    status_code=response.status_code,
                    body=_trim_body(response.text),
                ) from exc

            if not isinstance(payload, dict):
                raise LedgerClientError(
                    code="invalid_response",
                    message="Ledger returned JSON but not an object",
                    url=url,
                    status_code=response.status_code,
                    body=_trim_body(response.text),
                )
            return payload

    # Defensive fallback: should never be reached due explicit raises above.
    raise LedgerClientError(
        code="ledger_down",
        message=f"Ledger request failed: {last_request_error}",
        url=url,
    )

def _post_json(url: str, *, tenant_id: str = "service-tenant", trace_id: str | None = None) -> None:
    """
    POST to a ledger endpoint as the narrative service (no request body).
    Uses a service token with cbam:write scope. Does not retry — callers wrap in try/except.
    """
    timeout = httpx.Timeout(
        connect=LEDGER_CONNECT_TIMEOUT_S,
        read=LEDGER_READ_TIMEOUT_S,
        write=LEDGER_READ_TIMEOUT_S,
        pool=LEDGER_CONNECT_TIMEOUT_S,
    )
    token, _ = create_access_token(
        sub="narrative-service",
        tenant_id=tenant_id,
        scopes=["cbam:write", "narrative:run"],
    )
    headers = {"Authorization": f"Bearer {token}"}
    if trace_id:
        headers["X-Request-Id"] = trace_id

    with httpx.Client(timeout=timeout) as client:
        try:
            response = client.post(url, headers=headers)
        except httpx.RequestError as exc:
            raise LedgerClientError(
                code="ledger_down",
                message=f"Ledger POST failed: {exc}",
                url=url,
            ) from exc

        if response.status_code >= 400:
            raise LedgerClientError(
                code="review_flag_failed",
                message=f"Ledger returned {response.status_code}",
                url=url,
                status_code=response.status_code,
                body=_trim_body(response.text),
            )


def flag_review(case_id: str, *, tenant_id: str = "service-tenant", trace_id: str | None = None) -> None:
    """Signal to ledger that this case requires human review (Gemini flagged it)."""
    base = settings.ledger_base_url.rstrip("/")
    _post_json(f"{base}/api/cases/{case_id}/review/flag", tenant_id=tenant_id, trace_id=trace_id)


def clear_review(case_id: str, *, tenant_id: str = "service-tenant", trace_id: str | None = None) -> None:
    """Signal to ledger that the pipeline passed — clear any pending review flag."""
    base = settings.ledger_base_url.rstrip("/")
    _post_json(f"{base}/api/cases/{case_id}/review/clear", tenant_id=tenant_id, trace_id=trace_id)


def fetch_report_package(case_id: str, *, tenant_id: str = "service-tenant", trace_id: str | None = None) -> dict:
    base = settings.ledger_base_url.rstrip("/")
    url = f"{base}/api/cases/{case_id}/report-package"
    return _fetch_json(url, tenant_id=tenant_id, trace_id=trace_id)


def fetch_cbam_report_package(case_id: str, *, tenant_id: str = "service-tenant", trace_id: str | None = None) -> dict:
    base = settings.ledger_base_url.rstrip("/")
    url = f"{base}/api/cbam/cases/{case_id}/report-package"
    return _fetch_json(url, tenant_id=tenant_id, trace_id=trace_id)
