# Marketing site — to-do

Started 30 September 2026. Decisions: CBAM is a **second audience** with its own page (the home page stays the operational-data offer); the **marketing site is exempt** from the product's type and colour rules, with its own tokens in `marketing.css`.

## A. CBAM for importers (second audience)

- [ ] A1. Commit the existing marketing work unchanged to a branch, so later changes are reviewable on their own.
- [ ] A2. Write a CBAM page for importers at `/cbam-compliance` (`/cbam` is the product's own route). Every claim checked against the code:
  - the problem, with its dates (UK charges from 1 January 2027, first return due 31 May 2028; EU declarations);
  - what Arbor prepares: UK return figures and document, EU declaration file. It prepares; it does not submit;
  - collecting supplier emissions data (supplier form, published defaults when none);
  - verification statements, carbon price relief, "Why this number?", supplier history, audit narrative;
  - boundaries: HMRC-published rates, relief counted only with a verifier's statement, drafts to review before filing.
- [ ] A3. Link it: main navigation, footer, and a short band on the home page pointing importers to it.
- [ ] A4. Pricing: an importer section. Pilot terms only; no invented prices. **Owner decision needed** if a price is to be shown.
- [ ] A5. Request form and admin review: add "importer" as an audience.
- [ ] A6. About: replace the hedged CBAM line with a plain statement and a link.

## B. Tone

- [ ] B1. Gather the repeated caveats (what labels, extraction and exports do not prove) into one clear section on How it works; keep the legal detail in the legal pages. Trim repeats on Home, How it works, Pricing and Security.
- [ ] B2. Home hero example: lead with a record that shows the product at its best, and keep the explanation honest.
- [ ] B3. Re-read every page for defensive phrasing; keep every fact that the claims register requires.

## C. Design rules

- [ ] C1. Record the marketing-site exemption in `CLAUDE.md`.
- [ ] C2. Turn the scattered colour values in `marketing.css` into `--mk-` tokens defined once.
- [ ] C3. Admin enquiry page and its nav link: design-system tokens and weights only (they are product screens).

## D. Publishing blockers

- [ ] D1. **Owner:** authoritative company name, number, registered address and ICO position. The pages say arbor Data Ltd; the old DPA said Nucleos Compliance Ltd.
- [ ] D2. **Owner:** confirm `arbor.io` is owned and `hello@`, `legal@` and `security@` inboxes exist, or choose the addresses to use (used in 27 places).
- [ ] D3. Alert on new enquiries (Slack message per pilot/institutional enquiry). **Owner:** name who handles them.
- [ ] D4. **Owner + counsel:** retention schedule, then legal review of Privacy, Terms and DPA.
- [ ] D5. Apply the pilot-enquiry migration to production before the form goes live.
- [ ] D6. Full check before publishing: build, every page at phone to desktop widths, keyboard pass, form submission against a non-production database.
