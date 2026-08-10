import re
from typing import Dict, Any

# Very basic deterministic patterns (we expand later)
PATTERNS = {
    "electricity_kwh": r"Electricity[:\s]*([\d,\.]+)\s*kWh",
    "natural_gas_kwh": r"Natural Gas[:\s]*([\d,\.]+)\s*kWh",
    "production_units": r"([\d,\.]+)\s*units",
}

def _clean_number(value: str) -> float:
    return float(value.replace(",", ""))

def deterministic_extract(text: str) -> Dict[str, Any]:
    results = {}

    for field, pattern in PATTERNS.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            results[field] = _clean_number(match.group(1))
        else:
            results[field] = None

    return results
