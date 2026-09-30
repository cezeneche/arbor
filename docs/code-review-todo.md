# Code review fixes

Created 30 September 2026 from an outside review of the codebase. Every finding below was checked against the code before being listed. Order is the review's: correctness first, then maintainability.

The owner's own items and the engineering backlog are in `docs/engineering-todo.md`.

## Correctness

- [x] **R1. The review screen can show the wrong tier.** `ExtractionReview.tsx` predicts the tier with an empty organisation name and no reporting-period end. The save route (`documents/[id]/confirm/route.ts`) supplies both, and the certification policy uses them to catch a document naming another organisation or a certificate that has expired. So the screen can say Verified and the record save as Declared.
  - Fix: one function decides the tier for both, from the same inputs; the review page passes the organisation's name; the screen passes the period end it will send.
  - Done (`src/lib/layer2/review-tier.ts`). Checking showed only the period end changed a tier today: a name mismatch is a warning, not a downgrade. The case that broke was a certificate that expired inside its period (for example a REGO expiring in June of its vintage year), shown Verified and saved Declared.
- [ ] **R2. Portal tables can be clipped with no way to scroll.** The portal is desktop-only by owner decision, and that stays. But the shell keeps a 216 px sidebar and 40 px padding at every width, and the eight-column Records table sits in `overflow: hidden`, so on a small laptop columns can be cut off with no scroll.
  - Fix: wide tables scroll sideways inside their card instead of clipping. A responsive portal is a separate owner decision.
- [ ] **R3. A malformed page number reaches Prisma as NaN.** Records, Activity and the audit API use `Math.max(1, parseInt(...))`; `?page=abc` stays `NaN` and becomes `skip`. The audit API's `limit` has the same problem.
  - Fix: one tested parser for page and limit, used everywhere.
- [ ] **R4. The confirm route can notify about a failed attempt.** `supersededScopes` is declared outside the transaction callback, and `runSerializable` retries that callback on a write conflict. A failed attempt's pushes survive into the next, so post-commit notifications can repeat or name scopes that were never superseded.
  - Fix: the callback returns what it superseded, so only the committed attempt counts. Check the route for any other state that outlives an attempt.
  - Later: the route is 651 lines (validation, replacement, audit, notifications, CBAM handoff). Split it once R4 is covered by a test.

## Maintainability

- [ ] **R5. Two page widths on the marketing site.** The header and footer frame is 1140 px with up to 40 px padding (1060 px of content); sections use a 1160 px container. At 1440 px the section content starts about 50 px further left than the header.
  - Fix: one width, used by both.
- [ ] **R6. Presentation drifts between screens.** The three legal pages each define the same typography and spacing objects; the enquiry review screen (`admin/enquiries`) uses browser-default form controls unlike the rest of the portal.
  - Fix: one shared set of legal-page styles; the enquiry screen uses the portal's input and button styles.
- [ ] **R7. Formatting and lint aren't enforced.** Some marketing JSX puts whole sections on one line (`docs/api/page.tsx`, `PilotRequestForm.tsx`). There is no formatter or format check. `npm run lint` fails with six errors, all in `docs/audits/2026-09-16-reproductions.cjs`, an audit evidence script (`npx eslint src` passes).
  - Fix: lint ignores the audit evidence folder (evidence stays as recorded); reflow the long JSX lines. A formatter across the whole repo is a larger diff and an owner call.

## Not a code defect

- The legal pages are marked as sample drafts (`LegalDraftNotice.tsx`). That is the known legal sign-off gap in `docs/marketing/todo.md` D4.
