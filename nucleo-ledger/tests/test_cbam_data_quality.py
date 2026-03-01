from __future__ import annotations

from app.services.cbam_data_quality import evaluate_cbam_data_quality


def test_invoice_number_missing_not_triggered_when_only_entry_reference_present():
    case_row = {
        "id": "case-1",
        "importer_eori": "GB123456789",
        "reporting_year": 2025,
        "reporting_quarter": 1,
    }
    shipments_payload = [
        {
            "shipment": {
                "id": "shipment-1",
                "origin_country": "TR",
                "invoice_number": None,
                "entry_reference": "ER-ONLY-001",
                "incoterm": "FOB",
            },
            "goods_lines": [
                {
                    "goods_line": {
                        "id": "line-1",
                        "cn_code": "720711",
                        "quantity": 1000,
                        "net_mass_kg": 1000,
                        "installation_id": "INST-1",
                    },
                    "latest_emissions": {"method": "actual"},
                }
            ],
        }
    ]

    result = evaluate_cbam_data_quality(case_row, shipments_payload)
    assert "shipment:shipment-1:invoice_number_missing" not in result["warnings"]
