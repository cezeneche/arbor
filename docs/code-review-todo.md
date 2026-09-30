# Code review fixes

Created 30 September 2026 from an outside review of the codebase. Every finding below was checked against the code before being listed. Order is the review's: correctness first, then maintainability.

The owner's own items and the engineering backlog are in `docs/engineering-todo.md`.

## Correctness

- [x] **R1. The review screen can show the wrong tier.** `ExtractionReview.tsx` predicts the tier with an empty organisation name and no reporting-period end. The save route (`documents/[id]/confirm/route.ts`) supplies both, and the certification policy uses them to catch a document naming another organisation or a certificate that has expired. So the screen can say Verified and the record save as Declared.
  - Fix: one function decides the tier for both, from the same inputs; the review page passes the organisation's name; the screen passes the period end it will send.
  - Done (`src/lib/layer2/review-tier.ts`). Checking showed only the period end changed a tier today: a name mismatch is a warning, not a downgrade. The case that broke was a certificate that expired inside its period (for example a REGO expiring in June of its vintage year), shown Verified and saved Declared.
- [x] **R2. Portal tables can be clipped with no way to scroll.** The portal is desktop-only by owner decision, and that stays. But the shell keeps a 216 px sidebar and 40 px padding at every width, and the eight-column Records table sits in `overflow: hidden`, so on a small laptop columns can be cut off with no scroll.
  - Fix: wide tables scroll sideways inside their card instead of clipping. A responsive portal is a separate owner decision.
  - Done. Six cards clipped their table: Records, Export, Shares, Audit package, Gap results, and the buyer-facing shared-data page (`/share/[token]`, not in the review). They now use `overflowX: 'auto'`, which keeps the rounded corners. Tables in cards without clipping already overflowed into the scrolling main area. A scan test (`src/lib/__tests__/table-scroll.test.ts`) fails if a table is put back inside a clipping card. Not checked in a browser: these screens need a signed-in session or a real share link.
- [x] **R3. A malformed page number reaches Prisma as NaN.** Records, Activity and the audit API use `Math.max(1, parseInt(...))`; `?page=abc` stays `NaN` and becomes `skip`. The audit API's `limit` has the same problem.
  - Fix: one tested parser for page and limit, used everywhere.
  - Done (`src/lib/pagination.ts`): only plain whole numbers count; anything else means page 1 or the default limit, and page is capped so `skip` stays exact. No other page or limit parsing found (`?year=abc` on benchmarks returns an empty list and never reaches Prisma).
- [x] **R4. The confirm route can notify about a failed attempt.** `supersededScopes` is declared outside the transaction callback, and `runSerializable` retries that callback on a write conflict. A failed attempt's pushes survive into the next, so post-commit notifications can repeat or name scopes that were never superseded.
  - Fix: the callback returns what it superseded, so only the committed attempt counts. Check the route for any other state that outlives an attempt.
  - Done. The callback now returns `{ recordIds, supersededScopes }`. Narrower than first described: notifications are de-duplicated per buyer and domain, so a repeated scope didn't double-send; the real harm was telling buyers about a supersession only the rolled-back attempt made. The route now has its first test (`confirm/__tests__/retry.test.ts`), which fails a first attempt with a write conflict after it superseded a record. Every other `runSerializable` caller was checked: the supplier submit route already resets its counter per attempt, and the rest keep no state outside the callback.
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
