**Endpoint inventory — 16 September 2026**

224 explicitly registered operations, including framework documentation routes and 10 legacy proxy operations. Automatically generated HEAD/OPTIONS methods and arbitrary expansions of catch-all routes are not counted.

A 307 is a login redirect, not a successful API response. A 200 on a public validation endpoint is not necessarily a successful verdict. These are unauthenticated checks, not authenticated workflow certification.

| Service | Method | Path | Unauthenticated result | Source |
|---|---|---|---|---|
| Arbor | GET | `/api/admin/accuracy/health` | 307 | `src/app/api/admin/accuracy/health/route.ts` |
| Arbor | POST | `/api/admin/auditor-access` | 307 | `src/app/api/admin/auditor-access/route.ts` |
| Arbor | POST | `/api/admin/benchmarks/compute` | 307 | `src/app/api/admin/benchmarks/compute/route.ts` |
| Arbor | GET | `/api/admin/benchmarks/dp` | 307 | `src/app/api/admin/benchmarks/dp/route.ts` |
| Arbor | GET | `/api/admin/calibration/health` | 307 | `src/app/api/admin/calibration/health/route.ts` |
| Arbor | GET | `/api/admin/constraints/scan` | 307 | `src/app/api/admin/constraints/scan/route.ts` |
| Arbor | POST | `/api/admin/definitions` | 307 | `src/app/api/admin/definitions/route.ts` |
| Arbor | POST | `/api/admin/entity-links/[id]` | 307 | `src/app/api/admin/entity-links/[id]/route.ts` |
| Arbor | GET | `/api/admin/entity-links` | 307 | `src/app/api/admin/entity-links/route.ts` |
| Arbor | GET | `/api/admin/flow/anomalies` | 307 | `src/app/api/admin/flow/anomalies/route.ts` |
| Arbor | GET | `/api/admin/graph/neighbourhood` | 307 | `src/app/api/admin/graph/neighbourhood/route.ts` |
| Arbor | GET | `/api/admin/schema-inference` | 307 | `src/app/api/admin/schema-inference/route.ts` |
| Arbor | POST | `/api/admin/verification-assignments` | 307 | `src/app/api/admin/verification-assignments/route.ts` |
| Arbor | POST | `/api/admin/zk/statement` | 307 | `src/app/api/admin/zk/statement/route.ts` |
| Arbor | DELETE | `/api/api-keys/[id]` | 307 | `src/app/api/api-keys/[id]/route.ts` |
| Arbor | GET | `/api/api-keys` | 307 | `src/app/api/api-keys/route.ts` |
| Arbor | POST | `/api/api-keys` | 307 | `src/app/api/api-keys/route.ts` |
| Arbor | GET | `/api/audit/[entityId]` | 307 | `src/app/api/audit/[entityId]/route.ts` |
| Arbor | GET | `/api/audit/[entityId]/verify` | 307 | `src/app/api/audit/[entityId]/verify/route.ts` |
| Arbor | POST | `/api/audit/verify-public` | 200 | `src/app/api/audit/verify-public/route.ts` |
| Arbor | GET | `/api/audit/verify-public` | 200 | `src/app/api/audit/verify-public/route.ts` |
| Arbor | GET | `/api/audit-package/[entityId]` | 307 | `src/app/api/audit-package/[entityId]/route.ts` |
| Arbor | GET | `/api/audit-package/me` | 307 | `src/app/api/audit-package/me/route.ts` |
| Arbor | POST | `/api/auth/2fa/complete` | 401 | `src/app/api/auth/2fa/complete/route.ts` |
| Arbor | POST | `/api/auth/2fa/disable` | 401 | `src/app/api/auth/2fa/disable/route.ts` |
| Arbor | POST | `/api/auth/2fa/enable` | 401 | `src/app/api/auth/2fa/enable/route.ts` |
| Arbor | POST | `/api/auth/2fa/setup` | 401 | `src/app/api/auth/2fa/setup/route.ts` |
| Arbor | GET | `/api/auth/[...nextauth]` | not exercised: framework/external flow | `src/app/api/auth/[...nextauth]/route.ts` |
| Arbor | POST | `/api/auth/[...nextauth]` | not exercised: framework/external flow | `src/app/api/auth/[...nextauth]/route.ts` |
| Arbor | POST | `/api/auth/forgot-password` | 200 | `src/app/api/auth/forgot-password/route.ts` |
| Arbor | POST | `/api/auth/reset-password` | 400 | `src/app/api/auth/reset-password/route.ts` |
| Arbor | GET | `/api/benchmarks` | 307 | `src/app/api/benchmarks/route.ts` |
| Arbor | GET | `/api/cbam/cases/[caseId]/calculate` | 307 | `src/app/api/cbam/cases/[caseId]/calculate/route.ts` |
| Arbor | POST | `/api/cbam/cases/[caseId]/return` | 307 | `src/app/api/cbam/cases/[caseId]/return/route.ts` |
| Arbor | GET | `/api/cbam/cases/[caseId]` | 307 | `src/app/api/cbam/cases/[caseId]/route.ts` |
| Arbor | POST | `/api/cbam/cpr-calculate` | 307 | `src/app/api/cbam/cpr-calculate/route.ts` |
| Arbor | POST | `/api/cbam/cpr-claims` | 307 | `src/app/api/cbam/cpr-claims/route.ts` |
| Arbor | GET | `/api/cbam/default-value` | 307 | `src/app/api/cbam/default-value/route.ts` |
| Arbor | POST | `/api/cbam/scope-check` | 307 | `src/app/api/cbam/scope-check/route.ts` |
| Arbor | POST | `/api/cbam/supplier-token` | 307 | `src/app/api/cbam/supplier-token/route.ts` |
| Arbor | GET | `/api/cron/accuracy` | 401 | `src/app/api/cron/accuracy/route.ts` |
| Arbor | GET | `/api/cron/calibrate` | 401 | `src/app/api/cron/calibrate/route.ts` |
| Arbor | GET | `/api/cron/escalate-flags` | 401 | `src/app/api/cron/escalate-flags/route.ts` |
| Arbor | GET | `/api/cron/keepalive` | 401 | `src/app/api/cron/keepalive/route.ts` |
| Arbor | GET | `/api/cron/project-graph` | 401 | `src/app/api/cron/project-graph/route.ts` |
| Arbor | GET | `/api/cron/resolve-entities` | 401 | `src/app/api/cron/resolve-entities/route.ts` |
| Arbor | POST | `/api/definitions/agreements/[id]/respond` | 307 | `src/app/api/definitions/agreements/[id]/respond/route.ts` |
| Arbor | POST | `/api/definitions/agreements` | 307 | `src/app/api/definitions/agreements/route.ts` |
| Arbor | GET | `/api/definitions` | 307 | `src/app/api/definitions/route.ts` |
| Arbor | POST | `/api/documents/[id]/confirm` | 307 | `src/app/api/documents/[id]/confirm/route.ts` |
| Arbor | GET | `/api/documents/[id]` | 307 | `src/app/api/documents/[id]/route.ts` |
| Arbor | DELETE | `/api/documents/[id]` | 307 | `src/app/api/documents/[id]/route.ts` |
| Arbor | POST | `/api/documents/upload` | 307 | `src/app/api/documents/upload/route.ts` |
| Arbor | PATCH | `/api/entities/[entityId]/benchmark-consent` | 307 | `src/app/api/entities/[entityId]/benchmark-consent/route.ts` |
| Arbor | PATCH | `/api/entity` | 307 | `src/app/api/entity/route.ts` |
| Arbor | GET | `/api/flags/mine` | 307 | `src/app/api/flags/mine/route.ts` |
| Arbor | DELETE | `/api/grants/[id]` | 307 | `src/app/api/grants/[id]/route.ts` |
| Arbor | POST | `/api/grants/revoke-all` | 307 | `src/app/api/grants/revoke-all/route.ts` |
| Arbor | GET | `/api/grants` | 307 | `src/app/api/grants/route.ts` |
| Arbor | POST | `/api/grants` | 307 | `src/app/api/grants/route.ts` |
| Arbor | POST | `/api/inbound-email` | 401 | `src/app/api/inbound-email/route.ts` |
| Arbor | POST | `/api/inbound-requests/[id]/send` | 307 | `src/app/api/inbound-requests/[id]/send/route.ts` |
| Arbor | GET | `/api/inngest` | not exercised: framework/external flow | `src/app/api/inngest/route.ts` |
| Arbor | POST | `/api/inngest` | not exercised: framework/external flow | `src/app/api/inngest/route.ts` |
| Arbor | PUT | `/api/inngest` | not exercised: framework/external flow | `src/app/api/inngest/route.ts` |
| Arbor | POST | `/api/institutional/enquiry` | 422 | `src/app/api/institutional/enquiry/route.ts` |
| Arbor | POST | `/api/integrations/[provider]` | 307 | `src/app/api/integrations/[provider]/route.ts` |
| Arbor | DELETE | `/api/integrations/[provider]` | 307 | `src/app/api/integrations/[provider]/route.ts` |
| Arbor | POST | `/api/integrations/[provider]/sync` | 307 | `src/app/api/integrations/[provider]/sync/route.ts` |
| Arbor | GET | `/api/integrations` | 307 | `src/app/api/integrations/route.ts` |
| Arbor | GET | `/api/legal/dpa` | not exercised: framework/external flow | `src/app/api/legal/dpa/route.ts` |
| Arbor | GET | `/api/query/export` | 401 | `src/app/api/query/export/route.ts` |
| Arbor | POST | `/api/query/nl` | 401 | `src/app/api/query/nl/route.ts` |
| Arbor | GET | `/api/query` | 401 | `src/app/api/query/route.ts` |
| Arbor | GET | `/api/questionnaires/[template]/prefill` | 307 | `src/app/api/questionnaires/[template]/prefill/route.ts` |
| Arbor | GET | `/api/questionnaires` | 307 | `src/app/api/questionnaires/route.ts` |
| Arbor | GET | `/api/records/[id]` | 307 | `src/app/api/records/[id]/route.ts` |
| Arbor | POST | `/api/records/convert` | 401 | `src/app/api/records/convert/route.ts` |
| Arbor | GET | `/api/records/convert/units` | 200 | `src/app/api/records/convert/units/route.ts` |
| Arbor | POST | `/api/records/manual` | 307 | `src/app/api/records/manual/route.ts` |
| Arbor | GET | `/api/records` | 307 | `src/app/api/records/route.ts` |
| Arbor | PATCH | `/api/requests/[id]` | 307 | `src/app/api/requests/[id]/route.ts` |
| Arbor | POST | `/api/requests/[id]/token` | 307 | `src/app/api/requests/[id]/token/route.ts` |
| Arbor | GET | `/api/requests` | 307 | `src/app/api/requests/route.ts` |
| Arbor | POST | `/api/requests` | 307 | `src/app/api/requests/route.ts` |
| Arbor | POST | `/api/settings/benchmark-consent` | 307 | `src/app/api/settings/benchmark-consent/route.ts` |
| Arbor | POST | `/api/settings/cbam-jurisdiction` | 307 | `src/app/api/settings/cbam-jurisdiction/route.ts` |
| Arbor | DELETE | `/api/shares/[id]` | 307 | `src/app/api/shares/[id]/route.ts` |
| Arbor | POST | `/api/shares` | 307 | `src/app/api/shares/route.ts` |
| Arbor | GET | `/api/shares` | 307 | `src/app/api/shares/route.ts` |
| Arbor | POST | `/api/signup` | 400 | `src/app/api/signup/route.ts` |
| Arbor | GET | `/api/stewards` | 307 | `src/app/api/stewards/route.ts` |
| Arbor | PUT | `/api/stewards` | 307 | `src/app/api/stewards/route.ts` |
| Arbor | GET | `/api/submit/[token]` | 404 | `src/app/api/submit/[token]/route.ts` |
| Arbor | POST | `/api/submit/[token]` | 404 | `src/app/api/submit/[token]/route.ts` |
| Arbor | POST | `/api/supplier-form/[token]` | 307 | `src/app/api/supplier-form/[token]/route.ts` |
| Arbor | PATCH | `/api/user/profile` | 307 | `src/app/api/user/profile/route.ts` |
| Arbor | POST | `/api/v1/documents` | 401 | `src/app/api/v1/documents/route.ts` |
| Arbor | POST | `/api/v1/ingest` | 401 | `src/app/api/v1/ingest/route.ts` |
| Arbor | POST | `/api/v1/records/[recordId]/dispute` | 401 | `src/app/api/v1/records/[recordId]/dispute/route.ts` |
| Arbor | GET | `/api/v1/records` | 401 | `src/app/api/v1/records/route.ts` |
| Arbor | POST | `/api/v1/records` | 401 | `src/app/api/v1/records/route.ts` |
| Arbor | GET | `/api/v1/supply-chain/[supplierId]/records` | 401 | `src/app/api/v1/supply-chain/[supplierId]/records/route.ts` |
| Arbor | GET | `/api/v1/supply-chain/gaps` | 401 | `src/app/api/v1/supply-chain/gaps/route.ts` |
| Arbor | GET | `/api/v1/supply-chain` | 401 | `src/app/api/v1/supply-chain/route.ts` |
| Arbor | POST | `/api/verifier/assignments/[id]` | 307 | `src/app/api/verifier/assignments/[id]/route.ts` |
| Arbor | DELETE | `/api/webhooks/[id]` | 307 | `src/app/api/webhooks/[id]/route.ts` |
| Arbor | GET | `/api/webhooks` | 307 | `src/app/api/webhooks/route.ts` |
| Arbor | POST | `/api/webhooks` | 307 | `src/app/api/webhooks/route.ts` |
| Arbor | GET | `/api/workos/authorize` | not exercised: framework/external flow | `src/app/api/workos/authorize/route.ts` |
| Arbor | GET | `/api/workos/callback` | not exercised: framework/external flow | `src/app/api/workos/callback/route.ts` |
| Arbor | POST | `/api/workos/organization` | 401 | `src/app/api/workos/organization/route.ts` |
| Arbor | POST | `/api/workos/scim` | 401 | `src/app/api/workos/scim/route.ts` |
| Nucleos | GET | `/openapi.json` | Not exercised; public route | `FastAPI framework route` |
| Nucleos | GET | `/docs` | Not exercised; public route | `FastAPI framework route` |
| Nucleos | GET | `/docs/oauth2-redirect` | Not exercised; public route | `FastAPI framework route` |
| Nucleos | GET | `/redoc` | Not exercised; public route | `FastAPI framework route` |
| Nucleos | GET | `/api/health/deep` | Not exercised; public route | `nucleos/api/app/core/health.py` |
| Nucleos | GET | `/api/health` | Not exercised; public route | `nucleos/api/ledger_app/api/health.py` |
| Nucleos | GET | `/api/ready` | Not exercised; public route | `nucleos/api/ledger_app/api/health.py` |
| Nucleos | GET | `/api/health/ready` | Not exercised; public route | `nucleos/api/ledger_app/api/health.py` |
| Nucleos | GET | `/health` | Not exercised; public route | `nucleos/api/ledger_app/api/health.py` |
| Nucleos | GET | `/ready` | Not exercised; public route | `nucleos/api/ledger_app/api/health.py` |
| Nucleos | GET | `/health/ready` | Not exercised; public route | `nucleos/api/ledger_app/api/health.py` |
| Nucleos | POST | `/api/auth/token` | Not exercised; public route | `nucleos/api/ledger_app/api/auth.py` |
| Nucleos | POST | `/api/auth/supabase` | Not exercised; public route | `nucleos/api/ledger_app/api/auth.py` |
| Nucleos | GET | `/api/auth/context` | 401 | `nucleos/api/ledger_app/api/auth.py` |
| Nucleos | GET | `/api/auth/scope-check` | 401 | `nucleos/api/ledger_app/api/auth.py` |
| Nucleos | GET | `/api/db-check` | 401 | `nucleos/api/ledger_app/api/db_check.py` |
| Nucleos | GET | `/api/storage-check` | 401 | `nucleos/api/ledger_app/api/storage_check.py` |
| Nucleos | POST | `/api/storage-test-upload` | 401 | `nucleos/api/ledger_app/api/storage_check.py` |
| Nucleos | POST | `/api/cases` | 401 | `nucleos/api/ledger_app/api/cases.py` |
| Nucleos | GET | `/api/cases` | 401 | `nucleos/api/ledger_app/api/cases.py` |
| Nucleos | GET | `/api/cases/{case_id}` | 401 | `nucleos/api/ledger_app/api/cases.py` |
| Nucleos | POST | `/api/internal/cbam/extract` | 401 | `nucleos/api/ledger_app/api/cbam_extraction.py` |
| Nucleos | POST | `/api/internal/calculate` | 401 | `nucleos/api/ledger_app/api/cbam_calculate.py` |
| Nucleos | POST | `/api/cases/{case_id}/extract` | 401 | `nucleos/api/ledger_app/api/extract.py` |
| Nucleos | POST | `/api/cases/{case_id}/calculate` | 401 | `nucleos/api/ledger_app/api/calculate.py` |
| Nucleos | GET | `/api/cases/{case_id}/bundle` | 401 | `nucleos/api/ledger_app/api/bundle.py` |
| Nucleos | GET | `/api/cases/{case_id}/gaps` | 401 | `nucleos/api/ledger_app/api/gaps.py` |
| Nucleos | POST | `/api/cases/{case_id}/resolve-conflict` | 401 | `nucleos/api/ledger_app/api/resolve.py` |
| Nucleos | GET | `/api/cases/{case_id}/report-package` | 401 | `nucleos/api/ledger_app/api/report_package.py` |
| Nucleos | POST | `/api/cbam/scope-check` | 401 | `nucleos/api/ledger_app/api/cbam/cases.py` |
| Nucleos | GET | `/api/cbam/carbon-pricing-schemes` | 401 | `nucleos/api/ledger_app/api/cbam/cases.py` |
| Nucleos | POST | `/api/cbam/cases` | 401 | `nucleos/api/ledger_app/api/cbam/cases.py` |
| Nucleos | GET | `/api/cbam/cases/{case_id}` | 401 | `nucleos/api/ledger_app/api/cbam/cases.py` |
| Nucleos | PATCH | `/api/cbam/cases/{case_id}` | 401 | `nucleos/api/ledger_app/api/cbam/cases.py` |
| Nucleos | DELETE | `/api/cbam/cases/{case_id}` | 401 | `nucleos/api/ledger_app/api/cbam/cases.py` |
| Nucleos | GET | `/api/cbam/cases` | 401 | `nucleos/api/ledger_app/api/cbam/cases.py` |
| Nucleos | POST | `/api/cbam/classify` | 401 | `nucleos/api/ledger_app/api/cbam/classify.py` |
| Nucleos | POST | `/api/cbam/cases/{case_id}/goods-lines/{line_id}/reclassify` | 401 | `nucleos/api/ledger_app/api/cbam/classify.py` |
| Nucleos | POST | `/api/cbam/drafts/from-parsed-invoice` | 401 | `nucleos/api/ledger_app/api/cbam/drafts.py` |
| Nucleos | POST | `/api/cbam/shipments` | 401 | `nucleos/api/ledger_app/api/cbam/emissions.py` |
| Nucleos | POST | `/api/cbam/goods-lines` | 401 | `nucleos/api/ledger_app/api/cbam/emissions.py` |
| Nucleos | POST | `/api/cbam/emissions` | 401 | `nucleos/api/ledger_app/api/cbam/emissions.py` |
| Nucleos | GET | `/api/cbam/cases/{case_id}/summary` | 401 | `nucleos/api/ledger_app/api/cbam/report.py` |
| Nucleos | GET | `/api/cbam/cases/{case_id}/report-package` | 401 | `nucleos/api/ledger_app/api/cbam/report.py` |
| Nucleos | POST | `/api/cbam/cases/{case_id}/liability` | 401 | `nucleos/api/ledger_app/api/cbam/report.py` |
| Nucleos | GET | `/api/cbam/regulatory-tables` | 401 | `nucleos/api/ledger_app/api/cbam/report.py` |
| Nucleos | POST | `/api/cbam/cases/{case_id}/hmrc-return` | 401 | `nucleos/api/ledger_app/api/cbam/report.py` |
| Nucleos | POST | `/api/cbam/cases/{case_id}/eu-xml` | 401 | `nucleos/api/ledger_app/api/cbam/report.py` |
| Nucleos | GET | `/api/cbam/cases/{case_id}/explain` | 401 | `nucleos/api/ledger_app/api/cbam/explain.py` |
| Nucleos | GET | `/api/cbam/reconcile` | 401 | `nucleos/api/ledger_app/api/cbam/reconcile.py` |
| Nucleos | GET | `/api/cbam/suppliers/{supplier_eori}/see-history` | 401 | `nucleos/api/ledger_app/api/cbam/reconcile.py` |
| Nucleos | GET | `/api/cbam/insights/kpis` | 401 | `nucleos/api/ledger_app/api/cbam/insights.py` |
| Nucleos | GET | `/api/cbam/insights/supplier-comparison` | 401 | `nucleos/api/ledger_app/api/cbam/insights.py` |
| Nucleos | GET | `/api/cbam/insights/country-intensity` | 401 | `nucleos/api/ledger_app/api/cbam/insights.py` |
| Nucleos | GET | `/api/cbam/insights/sector-summary` | 401 | `nucleos/api/ledger_app/api/cbam/insights.py` |
| Nucleos | GET | `/api/cases/{case_id}/audit-log` | 401 | `nucleos/api/ledger_app/api/audit.py` |
| Nucleos | POST | `/api/cases/{case_id}/review/flag` | 401 | `nucleos/api/ledger_app/api/review.py` |
| Nucleos | POST | `/api/cases/{case_id}/review/clear` | 401 | `nucleos/api/ledger_app/api/review.py` |
| Nucleos | POST | `/api/cases/{case_id}/review/approve` | 401 | `nucleos/api/ledger_app/api/review.py` |
| Nucleos | POST | `/api/cases/{case_id}/review/reject` | 401 | `nucleos/api/ledger_app/api/review.py` |
| Nucleos | GET | `/api/cases/{case_id}/review` | 401 | `nucleos/api/ledger_app/api/review.py` |
| Nucleos | GET | `/api/public/cbam-cn-lookup` | Not exercised; public route | `nucleos/api/app/api/public_tools.py` |
| Nucleos | POST | `/api/public/cbam-scope-check` | Not exercised; public route | `nucleos/api/app/api/public_tools.py` |
| Nucleos | POST | `/api/public/cbam-liability-estimate` | Not exercised; public route | `nucleos/api/app/api/public_tools.py` |
| Nucleos | GET | `/api/public/supplier-form/{token}` | Not exercised; public route | `nucleos/api/app/api/supplier_token.py` |
| Nucleos | POST | `/api/public/supplier-form/{token}` | Not exercised; public route | `nucleos/api/app/api/supplier_token.py` |
| Nucleos | GET | `/api/cbam/cpr/qualifying-schemes` | 401 | `nucleos/api/app/api/cpr.py` |
| Nucleos | GET | `/api/cbam/cpr/exchange-rates` | 401 | `nucleos/api/app/api/cpr.py` |
| Nucleos | POST | `/api/cbam/cpr/calculate` | 401 | `nucleos/api/app/api/cpr.py` |
| Nucleos | POST | `/api/cbam/cpr/claims` | 401 | `nucleos/api/app/api/cpr.py` |
| Nucleos | GET | `/api/cbam/cpr/claims/{goods_line_id}` | 401 | `nucleos/api/app/api/cpr.py` |
| Nucleos | POST | `/api/cbam/cpr/upload-verification/{goods_line_id}` | 401 | `nucleos/api/app/api/cpr.py` |
| Nucleos | GET | `/api/cbam/registration/status` | 401 | `nucleos/api/app/api/registration.py` |
| Nucleos | PUT | `/api/cbam/registration` | 401 | `nucleos/api/app/api/registration.py` |
| Nucleos | GET | `/api/cbam/registration/alerts` | 401 | `nucleos/api/app/api/registration.py` |
| Nucleos | POST | `/api/cbam/registration/alerts/{alert_id}/acknowledge` | 401 | `nucleos/api/app/api/registration.py` |
| Nucleos | POST | `/api/cbam/goods-lines/{goods_line_id}/generate-supplier-request` | 401 | `nucleos/api/app/api/supplier_outreach.py` |
| Nucleos | POST | `/api/cbam/cases/{case_id}/generate-all-supplier-requests` | 401 | `nucleos/api/app/api/supplier_outreach.py` |
| Nucleos | POST | `/api/cbam/goods-lines/{goods_line_id}/supplier-token` | 401 | `nucleos/api/app/api/supplier_token.py` |
| Nucleos | POST | `/api/cbam/goods-lines/{goods_line_id}/request-verification` | 401 | `nucleos/api/app/api/verification.py` |
| Nucleos | POST | `/api/cbam/goods-lines/{goods_line_id}/upload-verification` | 401 | `nucleos/api/app/api/verification.py` |
| Nucleos | POST | `/api/cbam/goods-lines/{goods_line_id}/verify` | 401 | `nucleos/api/app/api/verification.py` |
| Nucleos | POST | `/api/cbam/goods-lines/{goods_line_id}/reject-verification` | 401 | `nucleos/api/app/api/verification.py` |
| Nucleos | GET | `/api/cbam/cases/{case_id}/verification-status` | 401 | `nucleos/api/app/api/verification.py` |
| Nucleos | POST | `/api/cbam/cases/{case_id}/compliance-pack` | 401 | `nucleos/api/app/api/cbam_compliance.py` |
| Nucleos | POST | `/api/cases/{case_id}/narrative/pipeline` | 401 | `nucleos/api/app/api/narrative_pipeline.py` |
| Nucleos | POST | `/api/cases/{case_id}/narrative/pipeline/async` | 401 | `nucleos/api/app/api/narrative_pipeline.py` |
| Nucleos | GET | `/tools/cbam-checker` | Not exercised; public route | `nucleos/api/main.py` |
| Nucleos | GET | `/` | Not exercised; public route | `nucleos/api/main.py` |
| Brain | GET | `/openapi.json` | 200 | `FastAPI framework route` |
| Brain | GET | `/docs` | 200 | `FastAPI framework route` |
| Brain | GET | `/docs/oauth2-redirect` | 200 | `FastAPI framework route` |
| Brain | GET | `/redoc` | 200 | `FastAPI framework route` |
| Brain | GET | `/health` | 200 | `brain/app/main.py` |
| Brain | POST | `/calibration/fit` | 401 | `brain/app/main.py` |
| Brain | POST | `/fusion/fields` | 401 | `brain/app/main.py` |
| Brain | POST | `/resolution/score` | 401 | `brain/app/main.py` |
| Brain | POST | `/infotheory/schema` | 401 | `brain/app/main.py` |
| Brain | POST | `/constraints/check` | 401 | `brain/app/main.py` |
| Brain | POST | `/flow/check` | 401 | `brain/app/main.py` |
| Brain | POST | `/privacy/benchmark` | 401 | `brain/app/main.py` |
| Legacy Nucleos web | GET | `/api-proxy/ledger/[...path]` | Static inspection only; app-specific dependencies not installed | `nucleos/web/src/app/api-proxy/ledger/[...path]/route.ts` |
| Legacy Nucleos web | POST | `/api-proxy/ledger/[...path]` | Static inspection only; app-specific dependencies not installed | `nucleos/web/src/app/api-proxy/ledger/[...path]/route.ts` |
| Legacy Nucleos web | PUT | `/api-proxy/ledger/[...path]` | Static inspection only; app-specific dependencies not installed | `nucleos/web/src/app/api-proxy/ledger/[...path]/route.ts` |
| Legacy Nucleos web | PATCH | `/api-proxy/ledger/[...path]` | Static inspection only; app-specific dependencies not installed | `nucleos/web/src/app/api-proxy/ledger/[...path]/route.ts` |
| Legacy Nucleos web | DELETE | `/api-proxy/ledger/[...path]` | Static inspection only; app-specific dependencies not installed | `nucleos/web/src/app/api-proxy/ledger/[...path]/route.ts` |
| Legacy Nucleos web | GET | `/api-proxy/narrative/[...path]` | Static inspection only; app-specific dependencies not installed | `nucleos/web/src/app/api-proxy/narrative/[...path]/route.ts` |
| Legacy Nucleos web | POST | `/api-proxy/narrative/[...path]` | Static inspection only; app-specific dependencies not installed | `nucleos/web/src/app/api-proxy/narrative/[...path]/route.ts` |
| Legacy Nucleos web | PUT | `/api-proxy/narrative/[...path]` | Static inspection only; app-specific dependencies not installed | `nucleos/web/src/app/api-proxy/narrative/[...path]/route.ts` |
| Legacy Nucleos web | PATCH | `/api-proxy/narrative/[...path]` | Static inspection only; app-specific dependencies not installed | `nucleos/web/src/app/api-proxy/narrative/[...path]/route.ts` |
| Legacy Nucleos web | DELETE | `/api-proxy/narrative/[...path]` | Static inspection only; app-specific dependencies not installed | `nucleos/web/src/app/api-proxy/narrative/[...path]/route.ts` |
