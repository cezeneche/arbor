"""The version stamp recorded on every golden case.

A frozen figure can move for two reasons: a regulatory table was deliberately
re-versioned, or something broke. Without the versions that produced it, those
look identical in a diff.
"""
from __future__ import annotations

__all__ = ["current_versions"]


def current_versions() -> dict[str, str]:
    from app.services.cbam_default_markup import MARKUP_TABLE_VERSION
    from ledger_app.core.version import APP_VERSION
    from ledger_app.services.cbam_emission_factors import (
        FACTOR_METADATA,
        TABLE_VERSION,
    )

    return {
        "engine_version": APP_VERSION,
        "factor_table_version": TABLE_VERSION,
        "factor_table_sha256": str(FACTOR_METADATA.get("table_sha256", ""))[:16],
        "markup_table_version": MARKUP_TABLE_VERSION,
    }
