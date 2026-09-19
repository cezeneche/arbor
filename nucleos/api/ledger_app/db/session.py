import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Check your .env file.")

_ssl_mode = os.getenv("DB_SSL_MODE", "").strip()  # "require" | "prefer" | "" (off)
_connect_args = {"sslmode": _ssl_mode} if _ssl_mode else {}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def db_healthcheck() -> dict:
    """Simple DB connectivity check."""
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1 as ok")).mappings().one()
        return {"db_ok": bool(result["ok"] == 1)}


# The tables a CBAM case is written to. A database missing any of them answers
# SELECT 1 and still cannot open a case.
REQUIRED_TABLES = (
    "cbam.cbam_cases",
    "cbam.cbam_shipments",
    "cbam.cbam_goods_lines",
    "cbam.cbam_emissions",
    "cbam.cbam_snapshots",
    "cbam.audit_log",
)


def missing_required_tables() -> list[str]:
    """The required tables this database does not have. Empty on SQLite."""
    if engine.dialect.name == "sqlite":
        return []
    with engine.connect() as conn:
        return [
            t for t in REQUIRED_TABLES
            if conn.execute(text("SELECT to_regclass(:t) IS NULL"), {"t": t}).scalar()
        ]
