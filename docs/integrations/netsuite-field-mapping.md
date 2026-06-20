# NetSuite → Arbor field mapping

**Scope:** Oracle NetSuite via the SuiteTalk REST Record API.

## Authentication
NetSuite uses OAuth (token-based authentication). Store the credentials blob in
Settings → Integrations:

```json
{
  "accountUrl": "https://<account>.suitetalk.api.netsuite.com",
  "accessToken": "<token>"
}
```

Credentials are encrypted at rest (AES-256-GCM).

## Mapped records

| NetSuite record | Arbor domain | Arbor field | Notes |
|---|---|---|---|
| `itemreceipt` | MATERIALS | `quantity` | goods received; `quantity` → value, `tranDate` → period |
| `vendorbill` | MATERIALS | `quantity` | purchase line quantities |
| `workorder` | PRODUCTION | `quantity_produced` | output quantity |
| `transferorder` | LOGISTICS | `quantity` | inter-site movements |

## Tier
Records are **Declared (Tier B)** / `SYSTEM_INTEGRATION`. Source documents
upgrade them to **Verified (Tier A)**.

## Sync
On demand via Settings → Integrations. Deduplicated by NetSuite internal id.
