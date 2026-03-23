import json
import hashlib
from pathlib import Path
from typing import Dict, Any, Tuple

FACTOR_SET_PATH_DEFAULT = Path("ledger_app/data/factors_uk_v1_placeholder.json")

def load_factor_set(path: Path = FACTOR_SET_PATH_DEFAULT) -> Tuple[Dict[str, Any], str]:
    """Load factor set JSON and return (factor_set_dict, sha256_hash)."""
    raw = path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    factor_set = json.loads(raw.decode("utf-8"))
    return factor_set, sha

def calculate_from_extraction(extracted: Dict[str, Any], factor_set: Dict[str, Any]) -> Dict[str, Any]:
    factors = factor_set["factors"]
    elec_factor = float(factors["electricity"])
    gas_factor = float(factors["natural_gas"])

    elec_kwh = float(extracted.get("electricity_kwh") or 0.0)
    gas_kwh = float(extracted.get("natural_gas_kwh") or 0.0)
    units = extracted.get("production_units")
    units_val = float(units) if units is not None else None

    elec_kg = elec_kwh * elec_factor
    gas_kg = gas_kwh * gas_factor
    total_kg = elec_kg + gas_kg

    per_unit_kg = None
    if units_val and units_val > 0:
        per_unit_kg = total_kg / units_val

    return {
        "inputs": {
            "electricity_kwh": elec_kwh,
            "natural_gas_kwh": gas_kwh,
            "production_units": units_val,
        },
        "results": {
            "scope_2_electricity_kgco2e": elec_kg,
            "scope_1_natural_gas_kgco2e": gas_kg,
            "total_kgco2e": total_kg,
            "kgco2e_per_unit": per_unit_kg,
        },
        "data_quality": {
            "electricity_primary": extracted.get("electricity_kwh") is not None,
            "natural_gas_primary": extracted.get("natural_gas_kwh") is not None,
            "production_primary": extracted.get("production_units") is not None,
        },
        "notes": [factor_set.get("notes", "")],
    }
