"""Whether a good's indirect emissions count towards its embedded total.

Indirect emissions (from electricity used in production) are always recorded
and reported. Whether they count towards the embedded emissions that a UK
charge or EU certificates are based on depends on the regime and the good.
"""
from __future__ import annotations

from ledger_app.services.cbam_taric import SECTOR_CEMENT, SECTOR_FERTILISERS, lookup_sector

# EU 2023/956 Art. 7(1), Annex II — goods in Annex II (iron and steel,
# aluminium, hydrogen) count direct embedded emissions only; cement and
# fertilisers count direct and indirect.
_EU_SECTORS_COUNTING_INDIRECT = frozenset({SECTOR_CEMENT, SECTOR_FERTILISERS})


def counts_indirect_emissions(cn_code: str, jurisdiction: str) -> bool:
    """True when the good's indirect emissions count in this regime.

    UK CBAM (Finance (No.2) Bill 2025-26) charges direct emissions only until
    2029 at the earliest, so the UK never counts them. A code outside CBAM
    Annex I has no sector, and counts direct emissions only.
    """
    if (jurisdiction or "").strip().upper() != "EU":
        return False
    return lookup_sector(cn_code or "") in _EU_SECTORS_COUNTING_INDIRECT
