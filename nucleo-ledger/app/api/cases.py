from fastapi import APIRouter
from pydantic import BaseModel, Field
from datetime import date
from sqlalchemy import text
from app.db.session import engine

router = APIRouter()

class CaseCreate(BaseModel):
    supplier_name: str = Field(..., min_length=1)
    supplier_country: str | None = None
    reporting_period_start: date
    reporting_period_end: date
    external_ref: str | None = None

@router.post("/cases")
def create_case(payload: CaseCreate):
    with engine.begin() as conn:
        row = conn.execute(
            text("""
                INSERT INTO cases (supplier_name, supplier_country, reporting_period_start, reporting_period_end, external_ref, status)
                VALUES (:supplier_name, :supplier_country, :start, :end, :external_ref, 'created')
                RETURNING id, supplier_name, supplier_country, reporting_period_start, reporting_period_end, status, created_at
            """),
            {
                "supplier_name": payload.supplier_name,
                "supplier_country": payload.supplier_country,
                "start": payload.reporting_period_start,
                "end": payload.reporting_period_end,
                "external_ref": payload.external_ref,
            },
        ).mappings().one()

        # audit log (use CAST instead of ::jsonb)
        conn.execute(
            text("""
                INSERT INTO audit_log (case_id, event_type, actor_type, event_json)
                VALUES (:case_id, 'case_created', 'human', CAST(:event_json AS jsonb))
            """),
            {
                "case_id": row["id"],
                "event_json": '{"note":"case created via API"}',
            },
        )

    return dict(row)
