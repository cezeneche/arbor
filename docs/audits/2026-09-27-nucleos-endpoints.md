# Nucleos endpoint audit — 27 September 2026

Nucleos mounts 89 routes. Arbor, which now owns every screen, calls 18 of them.
This lists all 89 by what they are for, so each can be kept, surfaced in Arbor,
or removed on purpose. Nothing is removed by this audit.

**Method.** The route table is the app's own (`main.app.routes`, loaded against
a throwaway SQLite database). Arbor's calls are every path in the 14 files that
reach `NUCLEOS_URL`. Public exposure was probed read-only against
`nucleos-api.vercel.app`.

Unless marked *public*, every route requires a Nucleos JWT. Arbor's service
token can reach all of them, so an unused route is still reachable by anyone
holding that token.

## 1. Used by Arbor — keep (18)

| Route | Arbor caller |
|---|---|
| `POST /api/internal/cbam/extract` | extraction-client |
| `POST /api/internal/calculate` | calculate-client |
| `GET, POST /api/cbam/cases` · `GET /api/cbam/cases/{id}` | cases-client, case-writer |
| `POST /api/cbam/shipments` · `/goods-lines` · `/emissions` | case-writer |
| `POST /api/cbam/scope-check` | scope-client |
| `POST /api/cbam/cpr/calculate` · `POST /api/cbam/cpr/claims` | cpr routes |
| `POST /api/cbam/goods-lines/{id}/supplier-token` | supplier-request-client |
| `GET, POST /api/public/supplier-form/{token}` *public* | supplier-form-client |
| `GET /api/public/cbam-cn-lookup` *public* | default-value-client |
| `GET /api/cases/{id}/audit-log` | cases-client |
| `POST /api/cbam/cases/{id}/eu-xml` · `/hmrc-return` | return-client |

## 2. Operations — keep (9)

`GET /health`, `/health/ready`, `/ready`, `/api/health`, `/api/health/ready`,
`/api/health/deep`, `/api/ready`, `/api/db-check`, `GET /`. `/ready` is what the
keepalive cron and Arbor's readiness check hit. Five spellings of "am I up" is
more than needed; consolidating them is housekeeping, not risk.

## 3. Remove first — risk, not just clutter (7)

| Route | Why |
|---|---|
| `POST /api/auth/supabase` | Exchanges a Supabase session for a Nucleos JWT. It was the login for `nucleos/web`, removed today. A live way to obtain Nucleos tokens that nothing needs. |
| `POST /api/storage-test-upload` | A test that writes a file to storage in production. Nucleos is not meant to hold documents (integration rule 4). |
| `GET /docs`, `/docs/oauth2-redirect`, `/redoc`, `/openapi.json` *public* | Publish the full route table, including everything in this audit, to anyone. Arbor does not use them. Disable in production (`docs_url=None`, etc.). |
| `POST /api/auth/token` | Dev token issuer. Correctly returns 404 unless `AUTH_DEV_TOKEN_ENDPOINT` is set, but a token minter in the production app is one environment variable from open. |

## 4. The pre-integration case pipeline — remove (17)

Nucleos's own document-to-return flow from before Arbor owned documents and
review. Arbor does extraction, review and provenance itself, and never calls
these.

`GET, POST /api/cases` · `GET /api/cases/{id}` · `POST /api/cases/{id}/extract`
· `/calculate` · `/resolve-conflict` · `GET /api/cases/{id}/bundle` · `/gaps` ·
`/report-package` · `/review` · `POST /api/cases/{id}/review/approve` · `/clear`
· `/flag` · `/reject` · `POST /api/cases/{id}/narrative/pipeline` · `/async` ·
`POST /api/cbam/drafts/from-parsed-invoice`

The narrative pipeline makes a Claude call; `drafts` is an invoice intake —
both duplicate what Arbor owns. **Check before removing:** the return builders
used by `eu-xml` and `hmrc-return` may call the report-package code as a
function. Remove the routes, not functions the builders import, and let the
golden set confirm it.

## 5. Served the removed front ends — remove (13)

| Routes | What they were for |
|---|---|
| `GET /api/cbam/insights/country-intensity`, `/kpis`, `/sector-summary`, `/supplier-comparison` | Nucleos dashboard charts |
| `GET /api/cbam/reconcile` | Nucleos reconciliation screen |
| `GET /api/auth/context`, `/api/auth/scope-check` | web app session plumbing |
| `GET /api/storage-check` | storage health for the old upload path |
| `POST /api/cbam/cases/{id}/generate-all-supplier-requests` · `POST /api/cbam/goods-lines/{id}/generate-supplier-request` | Nucleos-sent supplier emails; Arbor now issues supplier links via `supplier-token` |
| `GET /tools/cbam-checker` *public* | an HTML scope checker from the Nucleos marketing site; Arbor has its own scope check |
| `POST /api/public/cbam-scope-check` · `/cbam-liability-estimate` *public* | back ends for that public tool |

## 6. CBAM capability Arbor has not surfaced — decide (25)

Real CBAM functions with no Arbor screen. Each is either a gap in Arbor's CBAM
section or something to drop; leaving them reachable but unused is neither.

| Group | Routes | Note |
|---|---|---|
| Emissions verification | `POST /api/cbam/goods-lines/{id}/request-verification` · `/upload-verification` · `/verify` · `/reject-verification` · `GET /api/cbam/cases/{id}/verification-status` | "Actual, verified" emissions need an accredited verifier's statement. **Most likely a genuine gap**: without it every supplier figure stays unverified on the return. `upload-verification` stores a document, which belongs in Arbor (rule 4). |
| Carbon price relief extras | `GET /api/cbam/cpr/claims/{id}` · `/exchange-rates` · `/qualifying-schemes` · `POST /api/cbam/cpr/upload-verification/{id}` · `GET /api/cbam/carbon-pricing-schemes` | Arbor records and calculates relief but cannot list claims or show qualifying schemes. `upload-verification` again stores a document. |
| Registration | `GET /api/cbam/registration/status` · `PUT /api/cbam/registration` · `GET /api/cbam/registration/alerts` · `POST …/alerts/{id}/acknowledge` | UK threshold tracking (£50,000 over 12 months). A background scheduler starts with every instance for it. Useful to importers; no Arbor screen. |
| Case detail | `GET /api/cbam/cases/{id}/explain` · `/summary` · `/report-package` · `POST /liability` · `/compliance-pack` · `PATCH, DELETE /api/cbam/cases/{id}` | Arbor builds its case view from `GET /cases/{id}`; these are alternative views and mutations it never offers. `DELETE` in particular should not be reachable if Arbor never deletes a case. |
| Classification | `POST /api/cbam/classify` · `POST /api/cbam/cases/{id}/goods-lines/{line}/reclassify` · `GET /api/cbam/regulatory-tables` · `GET /api/cbam/suppliers/{eori}/see-history` | CN-code help and supplier history; no Arbor use. |

## Recommended order

1. **Section 3** now: disable the public docs, remove `auth/supabase` and
   `storage-test-upload`, and remove the dev token route or build it out of the
   production app.
2. **Sections 4 and 5** together: 30 routes, one change, golden set as the
   check.
3. **Section 6** as a product decision. Emissions verification is the one most
   likely to be needed for a real return; the rest can go until a customer asks.

The sections add up to the 89 routes (18 + 9 + 7 + 17 + 13 + 25). After the
first two steps Nucleos would expose 52; after the third, 27 plus whatever of
section 6 Arbor chooses to surface — each with a known caller.

## Outcome (27 September)

- **Section 3** removed (#119). **Sections 4 and 5** removed (#120).
- **Section 6**, decided with the owner:
  - *Emissions verification* — built. Statements are Arbor documents; Nucleos
    records a reference and hash (`upload-verification` takes JSON, not a file).
    Verified lines now reach both returns as actual, verified: neither builder
    had ever been given a verification reference.
  - *Carbon price relief* — claims list and qualifying schemes kept for Arbor to
    show; the statement upload takes a reference; `exchange-rates` removed.
  - *Registration* — scheduler off unless `CBAM_REGISTRATION_SCHEDULER=true`;
    routes kept for later.
  - *Case extras* — summary, liability, edit and delete removed. The report
    package stays: "explain this figure" reads its snapshot. The compliance pack
    stays and is to be surfaced in Arbor as the audit narrative.
  - *Explain* — `POST /cbam/cases/{id}/evidence` records what Arbor read from each
    document, keyed to goods-line ids; explain gained a tenant check. Reading any
    snapshot from Postgres had always failed (UUID/datetime/jsonb types), so
    explain had never worked in production at all.
  - *Classification* — `classify`, `reclassify`, `regulatory-tables` removed.
  - *Supplier history* — the broken `/suppliers/{eori}/see-history` is replaced by
    `GET /cbam/goods-lines/{id}/supplier-history`, read from recorded emissions,
    scoped to the owning organisation, flagged by the existing B2 rule. The
    `supplier_see_history` table is no longer read or written.
