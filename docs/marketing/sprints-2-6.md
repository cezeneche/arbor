# Marketing site — Sprints 2–6 implementation and acceptance record

Updated: 29 September 2026. This is local implementation and review evidence, not publication approval. The Sprint 1 inventory and original claims register are in `sprint-1.md`; this record supersedes its email-draft journey description. The later closeout attempt is recorded in `release-closeout-2026-09-30.md`.

## Final message and page copy map

| Surface | Primary message | Evidence or boundary made visible | Main action |
| --- | --- | --- | --- |
| Home | Operational data, ready to reuse | Illustrative bill-to-record example; Declared status, available source, correction history, permissioned sharing | Request supplier/buyer pilot access |
| How it works | From document to inspectable record | Upload → extract/review → labelled record → authorised sharing; technical audit explanation follows the customer journey | Request pilot access |
| Pricing | Pilot terms first; seven proposed future plans | Active record, upload and supplier-connection limits drawn from `src/lib/plan-limits.ts`; current pilot has individually agreed terms | Discuss a named plan via the request form |
| About | Reduce repeated reconstruction of operational figures | Repository purpose, provenance, correction and access principles; CBAM scope must be discussed for a specific case | Pilot request or general/legal contact |
| Institutional | Explore institutional uses | Coverage and evidence quality qualifiers; no response-time promise | Save an enquiry; privacy link |
| Security | Explain application controls without asserting unverified deployment guarantees | Access/grants, audit chain, key scope; current hosting, processor and assessment evidence requested separately | Security contact |
| API guide | Show working integration behaviour | Organisation-scoped read limit, filters, nullable evidence, partial ingest, idempotency and retries | Copy examples; integration contact |
| Privacy / Terms / DPA | Legal reading experience | Narrower column and section contents; Terms technical tier/export wording corrected; Privacy now mentions pilot and institutional enquiries | Legal contact; DPA download still needs reconciliation |
| Signup | Create an invited pilot account | Audience query parameter preselects buyer/supplier; failed requests retain entered data | Create account or request pilot access |

## Sprint 2 — visual foundations and copy

Implemented: scoped marketing type, spacing, colour and interaction classes in `marketing.css`; responsive compositions for Home, How it works, Pricing, About, API and the request page; stronger body type and clearer page hierarchy; unique titles/descriptions for core public routes and supporting pages. Existing portal typography remains independent. Home, How it works and About copy now put the document/record job before architecture language. The homepage has a concrete scenario and fewer repeated card sections.

Still open: real team/company story, authentic photography or approved product imagery, confirmed price/plan commercial terms, and a named editorial owner. No customer logos, performance statistics or people were invented.

## Sprint 3 — product explanation

Implemented: a shared, explicitly illustrative document-to-record example with an accessible source toggle. The same example appears on Home and How it works. The How it works page now leads with four customer steps, then explains tier qualification, correction history and HMAC verification boundaries. The example is not presented as a real customer record or a screenshot of the portal.

Still open: a product-approved real workflow capture, representative supported-document samples and measured outcome evidence if the site is to make time-saved claims.

## Sprint 4 — conversion and pricing

Implemented: `/request-access` retains supplier/buyer and named-plan context. `/api/pilot-enquiry` validates, rate-limits and saves requests to a dedicated `PilotEnquiry` model. A stable request ID makes retries after a lost response idempotent. The form has required labels, autocomplete, an optional use-case field, a privacy link, success/error announcements, timeout recovery and retained entries on failure. The public-path allowlist includes both page and endpoint; a built-site smoke test caught and then confirmed the fix for an initial login redirect. Signup can preselect buyer/supplier from an invitation URL and recovers from network/JSON failures. Pricing now separates current pilot terms from proposed plan prices and explains active-record and connection units using the plan-limit implementation.

Still open: deploy the new migration before publishing the form; appoint a person/team to monitor and respond to `PilotEnquiry` and `InstitutionalEnquiry`; establish a notification or review queue and retention schedule. No email notification is configured and no response-time promise is published. Upstash availability and rate-limit configuration should be checked in the deployment environment; the shared limiter currently fails open if Redis is unavailable. A stored row alone is not a complete follow-up process.

## Sprint 5 — trust, reference and legal

Implemented: Security now distinguishes code-level controls from deployment/contractual evidence. The API guide reflects its covered routes, request limits, filter semantics, partial ingestion responses and idempotency conflicts, with copyable examples. Privacy, Terms and DPA have narrow reading columns and contents links. Terms no longer defines Verified from confidence alone or promises that downloaded labels cannot be removed. Privacy describes collection through the new request form. A generated OpenAPI specification and exhaustive coverage of every v1 route remain future reference work; the page is labelled a guide.

**Publication blockers:** The authoritative contracting entity, company number, registered address and ICO status remain unconfirmed. The site DPA and its Markdown download name different providers and dates and contain differing clauses. Retention commitments in Privacy and DPA conflict; actual backups and deletion procedures need checking. Hosting region, encryption/provider terms, sub-processor transfers and external security assessments require operational evidence. The legal documents require qualified review. Do not treat the local technical copy changes as legal approval.

## Sprint 6 — verification

Completed checks: Prisma schema validation and client generation; TypeScript; targeted ESLint; `git diff --check`; 27 relevant tests for public paths, navigation, institutional recovery, the illustrative example and the pilot flow; webpack production build with static prerendering. Built-site HTTP checks returned 200 for Home, How it works, Pricing, About, Security, API, Institutional, Signup and legal routes. `/request-access?audience=buyer&plan=Business` returned 200 after the allowlist fix; an empty local POST to `/api/pilot-enquiry` returned 422 with no data write.

Safari Responsive Design Mode rendered the new Home first screen at 320 × 800: the mobile nav button, headline, stacked CTAs and example container were visible without first-screen clipping. It also exposed the new page and source button in the accessibility tree. This is **not** full mobile sign-off. Chrome's computer-use capture remained a blank grey surface. A separate Chrome for Testing launch was unavailable. The Safari interaction was interrupted by concurrent browser use after the 320px capture.

Still required before release: complete 320/375/390/768/1024/wide checks for every public route; check page-level horizontal scrolling, long text and 200% zoom; test mobile menu open/close and keyboard traversal in a real browser; inspect source-toggle and form announcements with a screen reader; run the request form against a migrated non-production database and verify the operator handoff; review contrast of all legacy legal and institutional content in rendered states. The default Turbopack build remains an environment-specific check: the webpack production build passed, while an earlier default build was blocked by font/network and worker-binding constraints.

No deployment, migration execution against a shared database, live enquiry submission, legal approval or publication occurred in this work.
