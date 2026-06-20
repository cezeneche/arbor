# SAP → Arbor field mapping

**Scope:** SAP S/4HANA (Cloud and on-premise) via standard OData services. No
custom ABAP required for the documented services; energy data needs either a
custom service or SAP Sustainability Management (SuM).

## Authentication
SAP OData supports Basic Auth (on-premise) and OAuth 2.0 (S/4HANA Cloud).
Store credentials in Arbor under Settings → Integrations as a JSON blob, e.g.

```json
{ "baseUrl": "https://my-s4.example.com", "basicAuth": "<base64 user:pass>" }
```

Credentials are encrypted at rest (AES-256-GCM) and never returned by the API.

## Mapped services

| SAP OData service | Arbor domain | Arbor field | Notes |
|---|---|---|---|
| `API_MATERIAL_DOCUMENT_SRV` (goods receipts) | MATERIALS | `quantity` | `QuantityInEntryUnit` → value, `EntryUnit` → unit, `PostingDate` → period |
| `API_PURCHASEORDER_PROCESS_SRV` | MATERIALS | `quantity` | PO line quantities |
| `API_OUTBOUND_DELIVERY_SRV` | LOGISTICS | `shipment_weight` | `NetWeight` → value |
| `ZMM_ENERGY_SRV` (custom) or SAP SuM | ENERGY | `total_consumption_kwh` | requires customer to expose energy data |

## Tier
Records created from SAP are **Declared (Tier B)** with extraction method
`SYSTEM_INTEGRATION`. Submitting the source document for the same reference
upgrades the record to **Verified (Tier A)**.

## Sync
Daily, or on demand via Settings → Integrations → Sync now. Records are
deduplicated by source reference (the SAP document number).
