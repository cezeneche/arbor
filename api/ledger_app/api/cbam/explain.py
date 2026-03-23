from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from . import _shared

router = APIRouter()


@router.get("/cases/{case_id}/explain")
def get_cbam_case_explain(
    case_id: UUID,
    metric: str | None = Query(default=None),
    field: str | None = Query(default=None),
):
    if bool(metric) == bool(field):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide exactly one of metric or field.",
        )

    snapshot_store = _shared.get_snapshot_store()
    case_id_str = str(case_id)

    try:
        if metric:
            return _shared.explain_metric(
                store=snapshot_store,
                case_id=case_id_str,
                metric=metric,
            )
        return _shared.explain_field(
            store=snapshot_store,
            case_id=case_id_str,
            field_path=str(field),
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found") from exc
