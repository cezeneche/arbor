from __future__ import annotations

from app.services.cbam_repair import repair_parsed_invoice


def test_repair_fills_invoice_number_and_date_from_header():
    parsed = {
        "layout": {
            "blocks": [
                {"type": "header", "text": "Invoice Number: INV-H-001 Invoice Date: 2025-03-31", "lines_idx": [0, 1]},
                {"type": "body", "text": "Line 1: 720711 | Coil | 10000 kg | net mass kg 10000", "lines_idx": [2]},
            ]
        },
        "full_text": "Noise only",
        "invoice": {
            "invoice_number": None,
            "invoice_date": None,
            "origin_country": "TR",
            "incoterm": "FOB",
        },
        "lines": [{"cn_code": "720711", "quantity": 10000, "net_mass_kg": 10000}],
    }

    repaired, warnings = repair_parsed_invoice(parsed)
    assert repaired["invoice"]["invoice_number"] == "INV-H-001"
    assert repaired["invoice"]["invoice_date"] == "2025-03-31"
    assert all(not warning.startswith("repair_failed:invoice_number") for warning in warnings)
    assert all(not warning.startswith("repair_failed:invoice_date") for warning in warnings)


def test_repair_does_not_invent_missing_values():
    parsed = {
        "layout": {"blocks": []},
        "full_text": "Importer: Demo Corp",
        "invoice": {"invoice_number": None, "invoice_date": None, "origin_country": None, "incoterm": None},
        "lines": [{"cn_code": None, "quantity": None, "net_mass_kg": None}],
    }

    repaired, warnings = repair_parsed_invoice(parsed)
    assert repaired["invoice"]["invoice_number"] is None
    assert repaired["invoice"]["invoice_date"] is None
    assert repaired["invoice"]["origin_country"] is None
    assert repaired["invoice"]["incoterm"] is None
    assert repaired["lines"][0]["cn_code"] is None
    assert repaired["lines"][0]["quantity"] is None
    assert repaired["lines"][0]["net_mass_kg"] is None

    assert "repair_failed:invoice_number" in warnings
    assert "repair_failed:invoice_date" in warnings
    assert "repair_failed:origin_country" in warnings
    assert "repair_failed:incoterm" in warnings
    assert "repair_failed:lines[0].cn_code" in warnings
