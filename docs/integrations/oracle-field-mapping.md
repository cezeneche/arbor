# Oracle Cloud ERP → Arbor field mapping (documentation only)

**Status:** No pre-built connector. Oracle Cloud ERP is deployed per-customer and
its REST configuration varies significantly between instances, so a single
pre-configured connector is not reliable. Integration is handled by the
customer's Oracle implementation partner using the generic ingest endpoint.

## Approach
Use the Arbor ingest API directly:

```
POST /api/v1/ingest
Authorization: Bearer <arbor-api-key>
```

Map Oracle records to Arbor's record shape and POST them in batches (max 500).
Records arrive as **Declared (Tier B)**; submit source documents to upgrade.

## Suggested mapping

| Oracle Cloud object | Arbor domain | Arbor field |
|---|---|---|
| Receiving Receipt Transactions | MATERIALS | `quantity` |
| Purchase Order Lines | MATERIALS | `quantity` |
| Work Order Completions | PRODUCTION | `quantity_produced` |
| Shipment Lines | LOGISTICS | `shipment_weight` |

## Authentication (Oracle side)
Oracle Cloud uses OAuth 2.0 via IDCS/IAM. The implementation partner obtains a
token and reads the REST resources above, then maps and posts to Arbor.

## When to revisit
If Oracle Cloud becomes a common request from enterprise buyers, build a
pre-configured connector following the SAP/NetSuite pattern.
