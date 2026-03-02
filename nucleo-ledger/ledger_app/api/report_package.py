from uuid import UUID

from fastapi import APIRouter, HTTPException

from ledger_app.api.cbam import get_cbam_report_package

router = APIRouter()


@router.get("/cases/{case_id}/report-package")
def report_package(case_id: str):
    try:
        cbam_case_id = UUID(case_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Not Found") from exc

    return get_cbam_report_package(cbam_case_id)
