from fastapi import APIRouter
from ledger_app.db.session import db_healthcheck

router = APIRouter(tags=["infrastructure"])

@router.get("/db-check")
def db_check():
    return db_healthcheck()
