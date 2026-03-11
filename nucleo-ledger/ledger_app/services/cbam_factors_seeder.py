"""CBAM Emission Factors DB Seeder.

Upserts the Annex VI default SEE values and country electricity factors
from ``cbam_emission_factors.py`` into the ``cbam.cbam_emission_factors``
and ``cbam.cbam_electricity_factors`` tables created in migration 007.

This makes the factor table queryable from the database — enabling:
  - Per-calculation audit trail (which version was used)
  - Historical factor versioning when the Commission updates values
  - Runtime queries without code access

Usage
-----
Called once at application startup by ``main.py`` (idempotent):

    from ledger_app.services.cbam_factors_seeder import seed_emission_factors
    seed_emission_factors(engine)

It is safe to call repeatedly — uses ``ON CONFLICT DO NOTHING`` so
subsequent calls after the first are no-ops.

Regulation references
---------------------
Commission Implementing Regulation EU 2023/1773, Art. 4(3) + Annex VI
"""

from __future__ import annotations

import logging
from datetime import date
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.engine import Engine

from ledger_app.services.cbam_emission_factors import (
    _ANNEX_VI,
    ELECTRICITY_FACTORS,
    TABLE_VERSION,
    FACTOR_METADATA,
)

log = logging.getLogger(__name__)

_EFFECTIVE_FROM = date(2023, 10, 1)  # CBAM transitional period start
_SOURCE_REF = f"EU 2023/1773 Annex VI (table_version={TABLE_VERSION})"
_SEEDED_BY = "startup_seeder"


def _tables_exist(conn) -> bool:
    """Return True if migration 007 has been applied."""
    result = conn.execute(text("""
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'cbam'
          AND table_name IN ('cbam_emission_factors', 'cbam_electricity_factors')
        LIMIT 1
    """)).scalar_one_or_none()
    return result is not None


def seed_emission_factors(engine: Engine) -> dict:
    """Upsert Annex VI SEE factors and electricity factors into the DB.

    Returns a summary dict: {"annex_vi_inserted": n, "electricity_inserted": m}.
    """
    annex_vi_count = 0
    electricity_count = 0

    try:
        with engine.begin() as conn:
            if not _tables_exist(conn):
                log.info(
                    "cbam_factors_seeder: migration 007 tables not found — "
                    "skipping seed (run migration 007 first)"
                )
                return {"annex_vi_inserted": 0, "electricity_inserted": 0, "skipped": True}

            # ── Annex VI SEE factors ──────────────────────────────────────────
            for entry in _ANNEX_VI:
                row = {
                    "id": str(uuid4()),
                    "cn8_prefix": entry.cn8_prefix,
                    "sector": entry.sector,
                    "production_route": entry.production_route,
                    "direct_tco2e_per_t": str(entry.direct_tco2e_per_t),
                    "indirect_tco2e_per_t": str(entry.indirect_tco2e_per_t),
                    "description": entry.description,
                    "source_ref": _SOURCE_REF,
                    "table_version": TABLE_VERSION,
                    "effective_from": _EFFECTIVE_FROM.isoformat(),
                    "effective_to": None,
                    "seeded_by": _SEEDED_BY,
                }
                result = conn.execute(text("""
                    INSERT INTO cbam.cbam_emission_factors (
                        id, cn8_prefix, sector, production_route,
                        direct_tco2e_per_t, indirect_tco2e_per_t,
                        description, source_ref, table_version,
                        effective_from, effective_to, seeded_by
                    ) VALUES (
                        :id, :cn8_prefix, :sector, :production_route,
                        :direct_tco2e_per_t, :indirect_tco2e_per_t,
                        :description, :source_ref, :table_version,
                        :effective_from, :effective_to, :seeded_by
                    )
                    ON CONFLICT (cn8_prefix, production_route, table_version)
                    DO NOTHING
                """), row)
                annex_vi_count += result.rowcount

            # ── Country electricity factors ───────────────────────────────────
            for country_iso2, tco2e_per_mwh in ELECTRICITY_FACTORS.items():
                row = {
                    "id": str(uuid4()),
                    "country_iso2": country_iso2,
                    "tco2e_per_mwh": str(tco2e_per_mwh),
                    "source_ref": "EU 2023/1773 Annex VI Table D",
                    "table_version": TABLE_VERSION,
                    "effective_from": _EFFECTIVE_FROM.isoformat(),
                    "effective_to": None,
                }
                result = conn.execute(text("""
                    INSERT INTO cbam.cbam_electricity_factors (
                        id, country_iso2, tco2e_per_mwh, source_ref,
                        table_version, effective_from, effective_to
                    ) VALUES (
                        :id, :country_iso2, :tco2e_per_mwh, :source_ref,
                        :table_version, :effective_from, :effective_to
                    )
                    ON CONFLICT (country_iso2, table_version)
                    DO NOTHING
                """), row)
                electricity_count += result.rowcount

        log.info(
            "cbam_factors_seeder: seeded %d Annex VI factors and "
            "%d electricity country factors (version=%s)",
            annex_vi_count, electricity_count, TABLE_VERSION,
        )
        return {
            "annex_vi_inserted": annex_vi_count,
            "electricity_inserted": electricity_count,
            "table_version": TABLE_VERSION,
            "factor_metadata": FACTOR_METADATA,
        }

    except Exception as exc:
        log.warning(
            "cbam_factors_seeder: seed failed (non-fatal) — %s", exc
        )
        return {"annex_vi_inserted": 0, "electricity_inserted": 0, "error": str(exc)}


def get_factor_from_db(
    conn,
    cn8_prefix: str,
    production_route: str | None = None,
    table_version: str = TABLE_VERSION,
) -> dict | None:
    """Look up a factor from the DB table (falls back to Python module if not found).

    Returns a dict with direct_tco2e_per_t, indirect_tco2e_per_t, description,
    source_ref, table_version — or None if not found.
    """
    row = conn.execute(text("""
        SELECT cn8_prefix, production_route, direct_tco2e_per_t,
               indirect_tco2e_per_t, description, source_ref, table_version
        FROM cbam.cbam_emission_factors
        WHERE cn8_prefix = :cn8_prefix
          AND (production_route = :production_route OR
               (:production_route IS NULL AND production_route IS NULL))
          AND table_version = :table_version
          AND effective_to IS NULL
        LIMIT 1
    """), {
        "cn8_prefix": cn8_prefix,
        "production_route": production_route,
        "table_version": table_version,
    }).mappings().one_or_none()
    return dict(row) if row else None
