from uuid import UUID

from fastapi import APIRouter, HTTPException, Request

from ledger_app.api.cbam import get_cbam_report_package

router = APIRouter(tags=["report"])


@router.get("/cases/{case_id}/report-package")
def report_package(request: Request, case_id: str):
    try:
        cbam_case_id = UUID(case_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Not Found") from exc

    return get_cbam_report_package(request, cbam_case_id)
