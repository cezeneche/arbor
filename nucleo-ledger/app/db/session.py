import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Check your .env file.")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def db_healthcheck() -> dict:
    """Simple DB connectivity check."""
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1 as ok")).mappings().one()
        return {"db_ok": bool(result["ok"] == 1)}
