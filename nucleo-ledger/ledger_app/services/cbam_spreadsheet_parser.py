"""CBAM Spreadsheet Ingestor — Excel (.xlsx) and CSV ingestion (A4).

Accepts bulk goods-line data submitted as structured spreadsheets.  Detects
column headers for the required CBAM fields and returns the same dict shape
as ``cbam_extractor.py``, enabling the standard pipeline to process
tabular supplier declarations.

Supported formats
-----------------
- ``.xlsx`` / ``.xls`` (via ``openpyxl``)
- ``.csv`` (stdlib ``csv``)

Expected column headers (case-insensitive, spaces/underscores normalised)
--------------------------------------------------------------------------
Required (at least one mass column must be present):
    cn_code         — 8-digit CN code
    net_mass_kg     — net mass in kg  (OR net_mass_t / net_mass_tonnes)
    net_mass_t      — net mass in tonnes (converted to kg)

Optional:
    description     — product description
    origin_country  — ISO 3166-1 alpha-2 country code
    method          — actual / default / estimated
    direct_emissions_kgco2e    — direct embedded emissions (kgCO2e)
    indirect_emissions_kgco2e  — indirect embedded emissions (kgCO2e)
    see_tco2e_per_t — specific embedded emissions (tCO2e/t)
    importer_eori   — importer EORI (header-level, from first data row if present)
    invoice_number  — invoice reference
    reporting_year  — e.g. 2024
    reporting_quarter — e.g. 2

Output shape (mirrors cbam_extractor output)
--------------------------------------------
Same dict structure as cbam_xml_declaration_parser output.
"""

from __future__ import annotations

import csv
import io
import re
from decimal import Decimal, InvalidOperation
from typing import Any

_D = Decimal
_ZERO = _D("0")

# ── Column name normalisation ─────────────────────────────────────────────────

_NORM_RE = re.compile(r"[\s_\-\.]+")


def _norm(name: str) -> str:
    """Normalise a column header: lower, strip, collapse separators."""
    return _NORM_RE.sub("", name.strip().lower())


# Maps normalised header → canonical field name
_HEADER_MAP: dict[str, str] = {
    "cncode": "cn_code",
    "cncodes": "cn_code",
    "hscode": "cn_code",
    "commoditycode": "cn_code",
    "tariffcode": "cn_code",
    "netmasskg": "net_mass_kg",
    "masskg": "net_mass_kg",
    "weightkg": "net_mass_kg",
    "nettweightkg": "net_mass_kg",
    "netmasst": "net_mass_t",
    "masst": "net_mass_t",
    "netmasstonnes": "net_mass_t",
    "netmasstone": "net_mass_t",
    "nettoneweight": "net_mass_t",
    "description": "description",
    "productdescription": "description",
    "goods": "description",
    "goodsdescription": "description",
    "origincountry": "origin_country",
    "countryoforigin": "origin_country",
    "origin": "origin_country",
    "method": "method",
    "calculationmethod": "method",
    "emissionsmethod": "method",
    "directemissions": "direct_embedded_kgco2e",
    "directemissionskgco2e": "direct_embedded_kgco2e",
    "directkgco2e": "direct_embedded_kgco2e",
    "directembedded": "direct_embedded_kgco2e",
    "directembeddedkgco2e": "direct_embedded_kgco2e",
    "indirectemissions": "indirect_embedded_kgco2e",
    "indirectemissionskgco2e": "indirect_embedded_kgco2e",
    "indirectkgco2e": "indirect_embedded_kgco2e",
    "indirectembedded": "indirect_embedded_kgco2e",
    "indirectembeddedkgco2e": "indirect_embedded_kgco2e",
    "seetco2pert": "see_tco2e_per_t",
    "specificembeddedemissions": "see_tco2e_per_t",
    "see": "see_tco2e_per_t",
    "importereori": "importer_eori",
    "eori": "importer_eori",
    "declaranteori": "importer_eori",
    "invoicenumber": "invoice_number",
    "invoice": "invoice_number",
    "reportingyear": "reporting_year",
    "year": "reporting_year",
    "reportingquarter": "reporting_quarter",
    "quarter": "reporting_quarter",
}


def _map_headers(headers: list[str]) -> dict[int, str]:
    """Return {column_index: canonical_field} for recognised headers."""
    mapping: dict[int, str] = {}
    for i, h in enumerate(headers):
        canonical = _HEADER_MAP.get(_norm(h))
        if canonical:
            mapping[i] = canonical
    return mapping


def _to_float(value: str | None) -> float | None:
    if value is None:
        return None
    cleaned = str(value).strip().replace(",", ".")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_rows(headers: list[str], rows: list[list[str]]) -> dict[str, Any]:
    col_map = _map_headers(headers)
    lines: list[dict] = []

    # Header-level metadata (from first data row or scan)
    meta: dict[str, Any] = {
        "importer_eori": None,
        "invoice_number": None,
        "origin_country": None,
        "reporting_year": None,
        "reporting_quarter": None,
    }

    evidence: list[dict] = []

    for row_idx, row in enumerate(rows):
        # Pad short rows
        while len(row) < len(headers):
            row.append("")

        row_data: dict[str, Any] = {}
        for col_idx, field in col_map.items():
            if col_idx < len(row):
                row_data[field] = row[col_idx] or None

        # Skip entirely empty rows
        if not any(row_data.values()):
            continue

        # Extract header-level metadata from any row (last non-empty wins)
        for meta_field in ("importer_eori", "invoice_number", "origin_country",
                           "reporting_year", "reporting_quarter"):
            if row_data.get(meta_field):
                meta[meta_field] = row_data[meta_field]

        cn_code = str(row_data.get("cn_code") or "").strip()
        if not cn_code:
            continue  # CN code is required for a valid goods line

        # Mass: prefer kg, fall back to tonnes × 1000
        mass_kg_raw = _to_float(row_data.get("net_mass_kg"))
        mass_t_raw = _to_float(row_data.get("net_mass_t"))
        if mass_kg_raw is None and mass_t_raw is not None:
            mass_kg_raw = mass_t_raw * 1000.0

        method = str(row_data.get("method") or "default").strip().lower()
        if method not in ("actual", "default", "estimated"):
            method = "default"

        direct = _to_float(row_data.get("direct_embedded_kgco2e"))
        indirect = _to_float(row_data.get("indirect_embedded_kgco2e")) or 0.0
        see = _to_float(row_data.get("see_tco2e_per_t"))

        # If SEE is given but direct is not, back-calculate direct from SEE × mass
        if direct is None and see is not None and mass_kg_raw:
            mass_t = mass_kg_raw / 1000.0
            direct = see * mass_t * 1000.0  # back to kgCO2e

        line = {
            "cn_code": cn_code,
            "description": row_data.get("description"),
            "quantity": mass_t_raw or (mass_kg_raw / 1000.0 if mass_kg_raw else None),
            "quantity_unit": "t",
            "net_mass_kg": mass_kg_raw,
            "method": method,
            "direct_embedded_kgco2e": direct,
            "indirect_embedded_kgco2e": indirect,
        }
        lines.append(line)

        evidence.append({
            "field": f"lines[{row_idx}].cn_code",
            "value": cn_code,
            "source": "spreadsheet_parser",
            "confidence": 0.90,
            "snippet": None,
        })

    # Aggregate totals for emissions block
    total_direct = sum(l["direct_embedded_kgco2e"] or 0 for l in lines)
    total_indirect = sum(l["indirect_embedded_kgco2e"] or 0 for l in lines)

    return {
        "importer": {
            "name": None,
            "eori": meta["importer_eori"] or "",
        },
        "invoice": {
            "invoice_number": meta["invoice_number"],
            "invoice_date": None,
            "origin_country": meta["origin_country"],
            "incoterm": None,
            "entry_reference": None,
        },
        "lines": lines,
        "emissions": {
            "method": lines[0]["method"] if lines else None,
            "direct_embedded_kgco2e": total_direct,
            "indirect_embedded_kgco2e": total_indirect,
        },
        "document_type": "spreadsheet",
        "reporting_year": int(meta["reporting_year"]) if meta["reporting_year"] else None,
        "reporting_quarter": int(meta["reporting_quarter"]) if meta["reporting_quarter"] else None,
        "evidence": evidence,
    }


# ── Public API ────────────────────────────────────────────────────────────────

def parse_csv(data: bytes, encoding: str = "utf-8") -> dict[str, Any]:
    """Parse a CSV file into the standard extractor output dict.

    Parameters
    ----------
    data:
        Raw CSV bytes.
    encoding:
        Character encoding (default UTF-8; falls back to Latin-1).

    Returns
    -------
    Extractor output dict with ``document_type = "spreadsheet"``.
    """
    try:
        text = data.decode(encoding)
    except UnicodeDecodeError:
        text = data.decode("latin-1")

    reader = csv.reader(io.StringIO(text))
    all_rows = list(reader)

    if not all_rows:
        return _empty_result()

    headers = all_rows[0]
    data_rows = all_rows[1:]
    return _parse_rows(headers, data_rows)


def parse_xlsx(data: bytes) -> dict[str, Any]:
    """Parse an .xlsx file into the standard extractor output dict.

    Requires the ``openpyxl`` package.  If not installed, raises ImportError
    with a clear message.

    Parameters
    ----------
    data:
        Raw .xlsx bytes.

    Returns
    -------
    Extractor output dict with ``document_type = "spreadsheet"``.
    """
    try:
        import openpyxl  # type: ignore[import]
    except ImportError as exc:
        raise ImportError(
            "openpyxl is required to parse .xlsx files. "
            "Install it with: pip install openpyxl"
        ) from exc

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.active

    all_rows = []
    for row in ws.iter_rows(values_only=True):
        all_rows.append([str(cell) if cell is not None else "" for cell in row])

    if not all_rows:
        return _empty_result()

    headers = all_rows[0]
    data_rows = all_rows[1:]
    return _parse_rows(headers, data_rows)


def parse_spreadsheet(filename: str, data: bytes) -> dict[str, Any]:
    """Dispatch to the appropriate parser based on the file extension.

    Parameters
    ----------
    filename:
        Original filename (used to determine format).
    data:
        Raw file bytes.

    Returns
    -------
    Extractor output dict.

    Raises
    ------
    ValueError
        If the file extension is not recognised.
    """
    lower = filename.strip().lower()
    if lower.endswith(".csv"):
        return parse_csv(data)
    if lower.endswith(".xlsx") or lower.endswith(".xls"):
        return parse_xlsx(data)
    raise ValueError(
        f"Unsupported spreadsheet format: {filename!r}. "
        "Supported: .csv, .xlsx, .xls"
    )


def _empty_result() -> dict[str, Any]:
    return {
        "importer": {"name": None, "eori": ""},
        "invoice": {
            "invoice_number": None,
            "invoice_date": None,
            "origin_country": None,
            "incoterm": None,
            "entry_reference": None,
        },
        "lines": [],
        "emissions": {"method": None, "direct_embedded_kgco2e": 0.0, "indirect_embedded_kgco2e": 0.0},
        "document_type": "spreadsheet",
        "reporting_year": None,
        "reporting_quarter": None,
        "evidence": [],
    }
