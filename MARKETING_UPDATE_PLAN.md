# Marketing Site Update Plan

Scope: reconcile the marketing site with what the portal now does, remove the
Security nav tab, add the new enterprise auth features, and a copy/messaging
review of the home page against the intended users. **Planning doc only — no code
changes yet.** Confirmed decisions from the product owner are noted inline.

---

## Part A — Accuracy fixes (legal/compliance; do first)

These are correctness issues, not polish. The sub-processor list must be accurate
for the DPA and GDPR.

### A1. Add WorkOS as a sub-processor  — **required**
`src/lib/legal/subprocessors.ts` lists Vercel, Supabase, Anthropic, Resend,
Inngest, Upstash — but **not WorkOS**, which now processes users' identity data
(email, name) through SSO and SCIM directory sync. Add:

```ts
{ name: 'WorkOS, Inc.', activity: 'Enterprise SSO authentication and SCIM directory provisioning',
  location: 'USA (SCCs in place)', dpaUrl: 'https://workos.com/legal/dpa' }
```
This one edit auto-updates the **Security page** and the **DPA** (both render from
`SUB_PROCESSORS`).

### A2. Reconcile the Privacy page's manual processor list  — **required**
`(marketing)/legal/privacy/page.tsx` §5 "Third-party processors" is a **separate,
hand-maintained list** (Supabase, Anthropic, Inngest…) that does not read from
`subprocessors.ts`. It is likely missing **Upstash and WorkOS**.
- Fix: refactor §5 to render from `SUB_PROCESSORS` so it can never drift again
  (preferred), or at minimum add Upstash + WorkOS by hand.

### A3. Bump `DPA_LAST_UPDATED`
Adding a sub-processor is a material change that normally triggers customer
notice; set the date to the change date when A1 ships.

---

## Part B — Remove the Security nav tab  — **decided**

- Remove the `<Link href="/security">Security</Link>` from
  `src/components/marketing/PublicNav.tsx` (centre links).
- **Keep** the footer link (`PublicFooter.tsx`, under "Legal") and the
  `/security` page itself. *(Owner decision: keep footer link + page — procurement
  and security reviewers expect a reachable `/security`, and the DPA links to it.)*

---

## Part C — Surface the new enterprise auth  — **approved to add**

SSO/SCIM now works end-to-end but isn't mentioned anywhere in marketing. Add it
where enterprise buyers look:

- **Security page → Access controls:** add a line — "Enterprise single sign-on
  (SAML/OIDC) and automatic user provisioning/de-provisioning via SCIM, through
  WorkOS." (Reinforces the security story and is accurate.)
- **Pricing → Enterprise plan:** add "SAML/OIDC SSO & SCIM provisioning" to the
  Enterprise feature list (natural gating; it's an enterprise capability).
- **Home "For buyers" card (optional):** the bullet list mentions API access;
  could add "Single sign-on and user provisioning for your team."

Related capabilities also under-emphasised for the buyer/enterprise audience
(optional, same theme): **ERP/customs connectors** (CDS/SAP/NetSuite),
**webhooks**, and the **audit package / third-party verifier** workflow. The buyer
card currently says only "API access."

---

## Part D — Copy & messaging review (home page)

Assessed against the PRD's primary user: *the office manager of a small
UK manufacturer, no sustainability or data background, who must be able to use the
product without help.* The PRD is explicit that every user-facing label is plain
English with no jargon, and that the motivating promise for SMEs is: *"respond to a
customer's data request in minutes instead of days."*

### D1. The hero speaks infrastructure, not user outcome  — **recommend revisiting**
Current hero:
- Eyebrow: **"Operational data infrastructure"**
- H1: **"Operational data, all in one verified data record."**
- Sub: "arbor reads your operational data, certifies the data, and stores it permanently…"

This is *accurate* but written in the founder's/technical register
("operational data infrastructure", "verified data record", "certifies the data").
It does not lead with the pain or the outcome the SME feels. Notably, the single
most motivating line already exists on the page — the supplier card's
**"Respond to any data request in minutes, not days"** — but it's buried mid-page.

**Recommendation (options, owner to choose):**
- **Option 1 — outcome-led (recommended for the primary SME persona):**
  - Eyebrow: "For manufacturers, suppliers & producers"
  - H1: *"Answer any customer's data request in minutes, not days."*
  - Sub: *"Upload the documents you already have — energy bills, invoices,
    delivery notes. Arbor reads them, certifies the data, and keeps one verified
    record you can share the moment a customer, auditor, or regulator asks."*
  - Keeps the two CTAs. Concrete nouns (bills/invoices) land better than
    "operational data" for the office-manager reader.
- **Option 2 — keep the infrastructure register** if the near-term go-to-market is
  actually enterprise buyers / investors rather than self-serve SMEs. Then the
  current hero is on-brand; instead strengthen the *buyer* value prop and add the
  enterprise features from Part C.
- The choice hinges on **who the site is selling to first** — that's a
  positioning decision for the owner, not a copy tweak.

### D2. The feature-strip stats use jargon  — **note**
"8 Data domains · 3 Trust tiers · HMAC · API" reads as sophistication to a
technical/buyer audience but is meaningless to the SME office manager ("HMAC",
"Data domains"). If the site leads with the SME persona (D1 Option 1), consider
plainer proof points (e.g. "Source-checked · Permanent record · Share in seconds ·
Free to start"). If it leads enterprise, leave as-is.

### D3. What is accurate and good (leave alone)
- The problem section, the four-step "how it works", the trust-tier cards, the
  supplier/buyer split, and the eight-domain grid are all clear, accurate to the
  build, and mostly plain English. The supplier card in particular is well
  written and benefit-led.
- Nothing on the home page is factually wrong versus what's shipped. The CTAs and
  "free to get started" are correct.

---

## Part E — SOC 2: how to actually set it up (answering the owner's question)

The Security page currently claims *"SOC 2 Type I in progress."* You said SOC 2
isn't set up. Two paths:

1. **Immediate (honest copy):** soften the claim until it's real — e.g. "We follow
   SOC 2-aligned controls; formal certification is on our roadmap." Leaving an
   unbacked "in progress" claim is a procurement/legal risk. **Do this as part of
   Part A.**
2. **Actually get SOC 2 (the real project):**
   - **Pick a compliance-automation platform** — Vanta, Drata, or Secureframe.
     They connect to your stack (Vercel, Supabase, GitHub, Google Workspace, etc.),
     inventory it, and continuously check the controls.
   - **Implement the controls it flags** — written security policies, access
     reviews, MFA everywhere (you already enforce admin 2FA), encryption at rest/in
     transit (you have this), logging/monitoring, vendor/sub-processor management,
     onboarding/offboarding, incident response (you have a doc in
     `docs/security/`), a risk register (also present).
   - **Engage a licensed CPA firm** (the platform partners you with one) to perform
     the audit. **Type I** = controls designed correctly at a point in time
     (~4–8 weeks once controls are in place). **Type II** = controls operating
     effectively over a window (**3–12 months** of evidence) — this is the one
     buyers actually want.
   - **Rough cost/time:** platform ~£7k–£20k/yr; auditor ~£8k–£25k; Type I in
     ~2–3 months from starting, Type II a further 6–12 months.
   - **Pragmatic sequence for a young product:** start the platform now → close the
     control gaps → Type I → begin the Type II observation window. Until Type I is
     signed, the site should not claim SOC 2.

---

## Execution sequencing (when approved)

- **PR 1 (accuracy + honesty):** A1 WorkOS sub-processor, A2 privacy list
  reconcile (render from source), A3 DPA date, and E1 soften the SOC 2 claim.
- **PR 2 (nav):** B — remove Security from the nav (keep footer + page).
- **PR 3 (enterprise surface):** C — SSO/SCIM on Security + Pricing (+ optional
  buyer-card line and ERP/webhooks mentions).
- **PR 4 (hero/copy):** D1 — only after the owner picks Option 1 vs 2 (positioning
  decision); D2 follows from that choice.

## Open decisions for the owner
1. Hero direction: **Option 1 (outcome-led, SME-first)** or **Option 2 (keep
   infrastructure register, enterprise-first)**? Everything in Part D/D2 follows.
2. SOC 2: soften the claim now (recommended) and/or start the real programme?
3. How far to take Part C — just SSO/SCIM, or also market ERP connectors,
   webhooks, and the verifier/audit-package workflow?
