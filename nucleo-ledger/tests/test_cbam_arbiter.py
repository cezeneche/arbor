from __future__ import annotations

from app.services.cbam_arbiter import arbitrate_parsed_invoice


def test_arbiter_picks_invoice_date_from_header_locality():
    rule_candidate = {
        "source": "rule",
        "layout": {"blocks": [{"type": "header", "text": "Invoice Date: 2025-01-15", "lines_idx": [0]}]},
        "full_text": "Invoice Date: 2025-01-15",
        "invoice": {"invoice_date": "2025-01-15", "invoice_number": "INV-001", "origin_country": "TR", "incoterm": "FOB"},
        "lines": [{"cn_code": "720711", "quantity": 10000, "net_mass_kg": 10000}],
    }
    llama_candidate = {
        "source": "llama",
        "layout": {"blocks": [{"type": "header", "text": "Invoice Date: 2025-01-15", "lines_idx": [0]}]},
        "full_text": "Invoice Date: 2025-01-15",
        "invoice": {"invoice_date": "2025-09-30", "invoice_number": "INV-001", "origin_country": "TR", "incoterm": "FOB"},
        "lines": [{"cn_code": "720711", "quantity": 10000, "net_mass_kg": 10000}],
    }

    result, warnings = arbitrate_parsed_invoice([rule_candidate, llama_candidate])
    assert result["invoice"]["invoice_date"] == "2025-01-15"
    assert any(warning.startswith("arbiter_conflict:invoice_date") for warning in warnings)


def test_arbiter_prefers_body_lines_over_header_noise():
    rule_candidate = {
        "source": "rule",
        "layout": {
            "blocks": [
                {"type": "header", "text": "Line 1: 999999 | Header noise | 1 kg", "lines_idx": [0]},
                {
                    "type": "body",
                    "text": (
                        "Line 1: 720711 | Hot rolled steel coil | 10000 kg | net mass kg 10000\n"
                        "Line 2: 730890 | Structural steel section | 5000 kg | net mass kg 5000"
                    ),
                    "lines_idx": [1, 2],
                },
            ]
        },
        "full_text": "Invoice Number: INV-1",
        "invoice": {"invoice_number": "INV-1", "invoice_date": "2025-01-15"},
        "lines": [
            {"cn_code": "720711", "quantity": 10000, "net_mass_kg": 10000},
            {"cn_code": "730890", "quantity": 5000, "net_mass_kg": 5000},
        ],
    }
    llama_candidate = {
        "source": "llama",
        "layout": rule_candidate["layout"],
        "full_text": "Invoice Number: INV-1",
        "invoice": {"invoice_number": "INV-1", "invoice_date": "2025-01-15"},
        "lines": [{"cn_code": "999999", "quantity": 1, "net_mass_kg": 1}],
    }

    result, warnings = arbitrate_parsed_invoice([rule_candidate, llama_candidate])
    assert len(result["lines"]) == 2
    cn_codes = {line["cn_code"] for line in result["lines"]}
    assert cn_codes == {"720711", "730890"}
    assert any(warning.startswith("arbiter_conflict:lines") for warning in warnings)
