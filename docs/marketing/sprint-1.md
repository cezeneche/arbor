# Marketing Sprint 1 — accuracy and urgent usability

Started: 28 September 2026. Updated: 29 September 2026. Scope: local implementation, not deployment.

Status: engineering changes implemented; factual decisions and visual acceptance remain open. Do not describe the marketing site or this sprint as fully signed off until the outstanding acceptance items below are closed.

## Scope and working decisions

The current public offer is a private pilot with invitations and individually agreed terms. This is supported by the existing Pricing and Signup pages, `src/lib/signup-access.ts`, and the account-creation route. Runtime admission can be changed by environment configuration; production configuration has not been inspected or modified.

Prospective customers request access by email using the existing `hello@arbor.io` contact. Invited users create their account at `/signup`; existing users sign in at `/login`. Supplier/buyer and named plan interest are carried into the email subject. An email link opens a draft: it neither submits an application nor confirms admission. A dedicated acquisition form and full signup context propagation belong to Sprint 4.

The contracting company has NOT been resolved. The pages name **arbor Data Ltd**; the downloadable DPA names **Nucleos Compliance Ltd**. Neither name has been assumed correct. Company number, address, ICO details, enquiry ownership and response-time commitments were requested from the product owner during this sprint. No reply has been recorded here yet.

## Page, section, and action inventory

| Surface | Sections / elements | Public actions and dependencies |
| --- | --- | --- |
| Shared navigation | Brand; How it works; Pricing; About; sign-in; pilot request; mobile disclosure | Home, three commercial routes, `/login`, pilot email draft. Accessible disclosure replaces hidden checkbox. |
| Shared footer | Brand description; product links; legal/security; contacts; company identity | Commercial/legal routes, pilot draft, `/signup` for invited users, `/login`, hello/legal email. Identity remains unresolved. |
| Home `/` | Audience eyebrow; hero; feature strip; problem and cards; four-step process; trust labels; supplier/buyer sections; eight domains; closing invitation | Workflow and pricing links; general and audience-specific pilot drafts. No open/free-access promise. |
| How it works `/how-it-works` | Introduction; three layers; upload/extraction/review/record/access steps; trust tiers; audit chain; supported documents; closing invitation | Pilot draft; Pricing. Workflow reflects automatic Declared records and review requirements. |
| Pricing `/pricing` | Introduction; pilot notice; four supplier plans; three buyer plans; billing/ownership/DPA notes | Pilot drafts retain audience and plan name; general request link. Listed prices are planned offerings, not checkout. |
| About `/about` | Purpose; repository; calculation/CBAM boundaries; why now; six principles; contacts; invitation | hello/legal contacts; pilot draft. CBAM output readiness needs separate evidence. |
| Institutional `/institutional` | Audience/hero; evidence/benchmarks/tiers; four use cases; enquiry form; success/error states; footer | `/login`; POST `/api/institutional/enquiry`; follow-up email address. Processing stores a database row; operational follow-up remains unassigned. |
| Security `/security` | Encryption; roles/authentication; audit chain; residency; sub-processors; assurance; disclosure | DPA; security email. Deployment and contractual claims need verification. |
| API `/docs/api` | Authentication; limits; five endpoint descriptions; webhook events/sample/signature examples; errors | Copyable examples and complete reference work belong to Sprint 5. Current rate-limit description remains in register. |
| Privacy `/legal/privacy` | Identity; collection; use; legal bases; processors/transfers; retention; rights; cookies; updates; contact | Legal contact. Identity placeholders and retention/AI disclosures need resolution. |
| Terms `/legal/terms` | Service; eligibility; ownership/content; permanent records; trust labels; sharing; acceptable use; IP; liability; indemnity; availability; termination; disputes; updates; contact | Legal contact. Provenance/accuracy distinction is now also explained in commercial copy. |
| DPA `/legal/dpa` | Definitions; scope; data categories; duration; obligations; processors; transfers; rights; breach notification; controls; deletion; audit; appendix; governing law; contact | `/api/legal/dpa` Markdown download. Provider, scope, dates, and clauses disagree with download. |
| DPA download `/api/legal/dpa` | Provider/version/date; scope; personal data; duties; appendix; transfers; security | Attachment `arbor-dpa-v1.md`. Not a PDF. Existing conflicting draft remains a publication blocker. |
| Signup `/signup` | Pilot notice; role selector; invitation; company/sector/country; person/email/password; legal agreement; submit; sign-in | POST `/api/signup`; legal routes; invitation-request email; `/login`. Title now explicitly describes a pilot account. |

## Claims register

“Corrected” means local copy changed; it does not mean production deployment or external verification. Owners below are role assignments for planning, not confirmed individual appointments.

| ID | Claim / issue | Evidence or source to verify | Owner | Status and next action |
| --- | --- | --- | --- | --- |
| C01 | Immediate free public access | `src/lib/signup-access.ts`; `src/app/api/signup/route.ts`; Pricing pilot notice | Product owner + engineering | Corrected: email request versus invited signup. Verify production admission configuration before launch. |
| C02 | Any request answered in minutes | No measured support supplied | Product/content | Removed timing/universal claim from Home; use reusable-record benefit. Timing claims require measured results and defined scope. |
| C03 | Nothing is stored before confirmation | `src/inngest/functions/extract-document.ts`; `src/lib/layer2/auto-accept.ts`; `src/lib/review/review-policy.ts` | Engineering | Corrected: eligible documents create Tier B records automatically; other documents require review. Extraction itself is also persisted. |
| C04 | AI operates only during ingestion | `src/lib/query-interpreter/nl-parser.ts`; `answer.ts` | Engineering | Corrected: AI also interprets queries and describes retrieved evidence; it does not write records through that query workflow. |
| C05 | Verified equals 85% confidence or any manual confirmation | `src/lib/layer2/certification-policy.ts`; `src/lib/nucleos/cbam-fields.ts`; confirm route | Engineering + content | Corrected commercial definitions: applicable source/review requirements; no claim of independent factual assurance. Harmonise legal definition in Sprint 5. |
| C06 | Declared means no document exists | `src/lib/layer2/auto-accept.ts`; certification policy; ingest/manual routes | Engineering + content | Corrected: includes automatically accepted and non-qualifying document-derived data. |
| C07 | Every figure has a source document | Manual and system-ingest records may lack one | Engineering + content | Corrected Home and Institutional: available evidence, document-derived figures. |
| C08 | Labels cannot be hidden after export | Exported copies are outside the application's control | Product + legal | Corrected commercial copy. Terms still needs aligned wording; do not promise technical control over external copies. |
| C09 | Records are permanent / never deleted | Record supersession versus Privacy/Terms/DPA deletion commitments | Engineering + legal | Partially corrected workflow wording. Remaining permanency language and retention promises need one consistent policy in Sprint 5. |
| C10 | Audit changes detected immediately and independently | `src/lib/layer2/audit-chain.ts`; `src/lib/audit-package/generator.ts`; verify-public route | Engineering/security | Corrected to verification-time detection; distinguish Arbor HMAC verification from package inclusion proofs. Full audit coverage wording remains for technical review. |
| C11 | CBAM applies to every EU import | Broad unsupported statement in About | Product/regulatory owner | Removed; replaced with general evidence-request context. Any new regulatory claim requires current primary-source verification. |
| C12 | Produces UK/EU regulatory outputs | About versus DPA download; actual CBAM export routes and supported reporting regimes | CBAM product owner + engineering | Open: confirm prepare/export/validate/submit boundary, jurisdiction and period support. DPA's “no regulatory outputs” conflicts and must be reconciled. |
| C13 | Every institutional dataset is ready for policy use | No availability/fitness evidence supplied | Institutional/product owner | Corrected to use cases to explore. Do not imply regulator endorsement or suitability assessment. |
| C14 | Live benchmark coverage and intensity methodology | `src/app/api/benchmarks/route.ts`; opt-in gate; population floor of 10 | Data/product owner | Corrected availability qualifier; removed general intensity promise. Live coverage, units/denominators, and research suitability remain unverified. |
| C15 | Enquiry reply within five business days | Enquiry API creates a row; no consumer found in source search | Business owner (individual unassigned) | Removed deadline. Confirm responsible person, queue/notification process, monitored contact, and achievable response target in Sprint 4. |
| C16 | Contracting company and registered details | Website: arbor Data Ltd; download: Nucleos Compliance Ltd; placeholders | Product owner + legal | BLOCKER: authoritative name, number, address and ICO position requested. Do not choose one from repetition alone. |
| C17 | DPA version, date, scope and duties | Page date 1 June; shared appendix/download 9 July; different clauses | Legal + engineering | BLOCKER: reconcile actual agreement and download together; establish shared versioned source in Sprint 5. |
| C18 | Privacy 90-day retention versus DPA deletion within 30 days | Privacy §7; DPA §11; actual deletion/backup procedures | Legal + operations | BLOCKER: confirm data categories, controller/processor distinctions and actual retention schedule; rewrite consistently. |
| C19 | TLS/AES encryption, storage and regional deployment | Security page; hosting/database/storage configuration and provider contracts | Security/operations | Open: code alone cannot confirm deployment or all provider guarantees. Collect evidence before publishing a verified posture. |
| C20 | SCCs, no-training terms and sub-processor use | `src/lib/legal/subprocessors.ts`; executed provider agreements | Legal + operations | Open: verify contracts/regions and describe query-time AI processing as well as extraction. |
| C21 | SOC 2 alignment and Q3 2026 penetration test | No external assessment evidence supplied | Security/business owner | Removed unverified dated assurance claim; contact route retained. Supply current reports/status before reinstating specific promises. |
| C22 | Admin 2FA, scoped/hashed keys, SSO and session revocation | Auth helpers, API-key auth, WorkOS configuration and role enforcement | Engineering/security | Code-level mechanisms exist; deployment configuration and full role coverage need Sprint 5 verification. |
| C23 | Planned prices, VAT, annual discount, free responses, entitlements | Pricing; `src/lib/plan-limits.ts`; public submission route; actual commercial terms | Commercial owner | Pilot/future distinction clarified. Prices and terms require owner confirmation; active-record examples, limit behaviour, and entitlement comparison in Sprint 4. |
| C24 | SLA, priority support, customer success and DPA plan inclusion | Pricing versus actual contracts/staffing and DPA applicability | Commercial + legal | Open: no evidence for operational guarantees reviewed. Specify or remove promises before public offer. |
| C25 | API rate limit per key | `src/app/api/v1/supply-chain/route.ts` uses buyer entity ID | Engineering/docs | Known copy correction queued for Sprint 5: organisation-scoped buyer limit, not per key. |
| C26 | Cookie/log/privacy and collection descriptions | Privacy versus installed services, enquiry collection and AI queries | Privacy/operations | Open: verify deployed behaviour and retention; no compliance conclusion drawn from source alone. |
| C27 | All output fields/SI conversion/evidence always present | Export serializers, canonical measurement, declared/estimated data | Engineering/docs | Open: qualify nullable evidence and distinguish stored numeric records from every extracted field in Sprint 2 copy pass. |

## Current journey map

1. Prospective supplier: Home supplier CTA → email draft with supplier subject → human review of request (owner unconfirmed) → invitation → `/signup` → select supplier → account creation → onboarding.
2. Prospective buyer: Home buyer CTA → email draft with buyer subject → review/invitation → `/signup` → select buyer → account creation → onboarding. Automatic audience transfer into signup is still Sprint 4 work.
3. Pricing visitor: selected plan CTA → email draft containing supplier/buyer and plan name → discussion of pilot terms. No price acceptance or checkout is implied.
4. Invited user: Footer “Create your invited account” or invitation link → `/signup` → invite code → creation. The API checks actual admission configuration; a code may be required or signup closed.
5. Existing user: Sign in → `/login` → existing application flow.
6. Institution: `/institutional` → validated enquiry POST → database storage → accessible saved confirmation. Network/server/timeout failure retains fields and allows deliberate retry. No notification or response deadline is claimed; operating the review queue remains a Sprint 4 dependency.
7. Procurement/security review: footer → Security / legal documents → DPA download or contact. Existing legal conflicts prevent trust-content sign-off.

## Prioritised backlog and implementation

| ID | Priority | Work | Sprint / current result |
| --- | --- | --- | --- |
| M01 | P1 | Accessible menu with expanded state, Escape, outside/focus exit, navigation close | S1 implemented; interaction tests pass. |
| M02 | P1 | Phone process layout, safe minimum grids, institutional stacking, flexible footer, responsive support-page gutters | S1 implemented; real viewport acceptance pending. |
| M03 | P1 | Navy text contrast and visible focus | S1 implemented; footer/eyebrow and highlighted pricing-card text opacity raised; full rendered contrast/focus checks pending. |
| M04 | P1 | Recoverable enquiry network/server/timeout states and announcements | S1 implemented; retry/timeout/error/success tests pass. No automatic retries. |
| M05 | P1 | Accurate invitation CTA and preserved request context | S1 implemented with email drafts; complete form/signup handoff S4. |
| M06 | P1 | Correct unsupported commercial/AI/tier claims | S1 corrections implemented; remaining legal/deployment claims explicitly open in register. |
| M07 | P1 | Company identity, DPA, retention and operational assurance decisions | Started S1; owner evidence needed, reconcile S5. Publication blockers remain. |
| M08 | P2 | Reusable visual system, typography and complete copy deck | S2. |
| M09 | P2 | Product demonstration and restructured Home/How it works | S3. |
| M10 | P1 | Accountable enquiry handling and full conversion paths | S4; do not reinstate response promises without evidence. |
| M11 | P2 | Pricing explanations, About, Security, API reference, legal templates and metadata | S4/S5 according to six-sprint plan. |
| M12 | P1 | Real mobile/desktop visual verification and full journey QA | Focused acceptance still open in S1; comprehensive coverage S6. |

P1 means significant usability, factual trust, or journey issue; P2 means improvement that can follow foundational fixes. Roles need named appointments where still unassigned.

## Verification and acceptance

- Seven interaction tests pass in `src/components/marketing/__tests__`: keyboard open/Escape/focus restoration; navigation close/current page; outside interaction/focus exit; route reset; network failure/retry/success; HTTP/non-JSON errors; stalled-request timeout.
- Tests mock requests and make no production enquiries or send emails. JSDOM does not establish responsive rendering or screen-reader behaviour.
- `npx tsc --noEmit --incremental false` — passed.
- Targeted ESLint over marketing pages, signup, Institutional, marketing components/tests, and the pilot helper — passed.
- `git diff --check` — passed.
- `npm run build -- --webpack` — passed, including static prerendering. This was a verification-only command; package scripts and bundler configuration were not changed.
- Default `npm run build` could not complete in this environment: initial font network access was blocked, and the rerun with network access failed at Turbopack worker port binding (`EPERM`). The default production build still needs checking in its deployment environment.
- Local Next development server started. All 11 public/signup page routes returned successfully. Parsed rendered HTML confirmed the corrected headline and pilot CTAs, supplier/buyer subjects, and named-plan context. HTTP success alone does not prove browser layout.
- Calculated contrast for updated 70%-white text over `#1B2F4A`: 7.46:1. This is a declared-colour check, not a claim that every rendered state has been audited.
- Browser check on 29 September: Safari rendered the desktop Home page and exposed its navigation, headline, CTAs, content and footer in the accessibility tree. The hero and first content section appeared at a wide desktop viewport without obvious clipping. That inspection revealed an awkward Home sentence and an over-absolute sharing line; both were corrected afterward. Chrome still showed a blank grey surface. Safari was then actively controlled elsewhere, interrupting entry to Responsive Design Mode, so no phone-width or cross-page visual acceptance is claimed.
- Still required: visually inspect Home, process rows, navigation and Institutional at 320px/390px; confirm closed-menu links are absent from keyboard/accessibility navigation; verify focus and error announcements in a real browser; verify long text and footer wrapping. Wider/device matrix remains Sprint 6.
- Still required: named legal/company and enquiry decisions; actual inbox monitoring and production admission configuration confirmation.

No deployment, new email notification integration, database migration, live enquiry, or account creation is part of this implementation package.
