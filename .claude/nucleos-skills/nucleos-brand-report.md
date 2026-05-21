# Nucleos Brand Identity — Implementation Report
**Authority**: George Lois · Dieter Rams · Steve Jobs
**Version**: 1.0

---

## What this report covers

Six things need to be built or updated to apply the Nucleos brand identity across the product. A seventh is an audit, not a build task. This report explains what each one is and why it exists. It does not explain how to build it — that is the engineer's job.

---

## 1. Brand tokens in the design system

The design system token file currently holds all visual values — colours, spacing, type sizes. It does not hold brand identity values. Those need to be added: the tagline, the company name, the legal name, the category description, the copyright year, and the mark's minimum permitted sizes.

The reason is consistency and single source of truth. If the tagline is hardcoded into individual components, it will diverge. If the copyright year is written as a literal string in the footer, it will be wrong in 2028. Brand constants belong in the same place as design constants — the token file — so they are imported, not typed by hand.

---

## 2. The mark as a component

The Nucleos logo does not currently exist as a proper component. The product uses a plain text string "Nucleos" wherever the logotype appears. That needs to be replaced with a purpose-built SVG component that renders the geometric N mark with its convergence point, and optionally the wordmark alongside it.

The reason is that a plain text string cannot carry the brand idea. The mark — the N whose diagonals converge at a weighted centre point — is the visual expression of what the product does: many inputs resolved to one number. A text string is just a label. The mark is an argument.

The component also enforces the rules that cannot be enforced by convention: minimum size, approved colour variants, flat stroke terminals. Once it is a component, those rules are in the code. They cannot be accidentally overridden by someone setting a font-weight or changing a colour.

---

## 3. The navigation bar

The nav bar currently uses the plain text logotype. It needs to use the mark component instead, and the right-side elements need to follow the brand specification: "Upload documents →" in navy, user name and sign out in secondary text. No additional elements.

The reason is that the nav bar appears on every authenticated page. It is the most repeated brand touchpoint in the product. If the logotype is wrong in the nav, it is wrong everywhere. Getting this right has the highest leverage of any single change in the implementation.

There is also a mobile consideration. Below 768px, the full wordmark is replaced by the mark alone — the icon variant. The user's name and sign out option become accessible via tap on the mark. This keeps the nav uncluttered at small sizes without introducing a hamburger menu, which would violate Rams's principle that navigation should not require explanation.

---

## 4. The favicon and page metadata

The browser tab, the page title, and the mobile browser chrome colour are all brand touchpoints that currently carry no deliberate brand signal. The favicon needs to be the N mark in navy. The page title needs to follow a consistent template. The theme colour needs to be set to navy so the browser chrome reflects the brand on mobile.

The reason the favicon uses navy rather than the primary text colour is that at 16 pixels — the size most favicons appear at — black is indistinguishable from browser interface elements. Navy reads as a deliberate, owned colour at that scale. It is the same logic that makes the brand primary navy rather than black: you cannot own black, but you can own this specific navy.

The metadata description needs to say one accurate thing: what Nucleos does, for whom. No marketing language. This text appears in search results, in link previews, and in browser bookmarks. It is a brand touchpoint with no visual design — voice is the only tool available.

---

## 5. The homepage logotype and tagline

The homepage unauthenticated state has two brand needs. The plain text logotype needs to be replaced with the mark component. And the tagline — "Your number. Confirmed." — needs to appear in one specific location: below the liability number in the IN SCOPE result, after the user has seen the number.

The placement is not arbitrary. The tagline is not a headline. It does not appear at the top of the page, before anything has been demonstrated. It appears after the number, because the number is the proof and the tagline is the confirmation of what was just shown. Sequence is the strategy: demonstrate first, name it second. A tagline that precedes its proof is a claim. A tagline that follows its proof is a conclusion.

The tagline appears nowhere else in the product. Not on the dashboard, not on case detail, not on upload. The product UI delivers certainty through function. The tagline is only needed at the one moment where a prospective user first encounters that certainty — and then only to name what they just experienced.

---

## 6. The auth pages logotype

The login and signup pages currently use a plain text "Nucleos" above the form. This needs to be the mark component. Nothing else on these pages changes.

The reason is simple: auth pages are a brand touchpoint. A user who has just seen the liability number on the homepage and clicked "Automate your compliance →" arrives at signup. The mark is the recognition signal that confirms they are in the right place. It does not need to sell. It does not need a tagline or a subheadline. The product already made the sale. The form is all that is needed now.

---

## 7. The footer

There is currently no footer component. One needs to be created. It carries the mark at its smallest permitted size, a single line describing what the product does, and minimal legal and privacy information on the right.

The footer is where brand consistency is most often lost. It is the last element on every page, designed last, reviewed least. Getting it right matters because it appears on every page and because it is often the element that exposes whether a brand has been applied with discipline or applied casually. A footer with the wrong typeface, a rogue colour, or a marketing claim where a plain description should be signals that the identity system is not being enforced. A footer that is quiet, correct, and consistent signals the opposite.

The footer does not carry the tagline. The tagline belongs to the homepage moment — the first encounter with the liability number. The footer carries the voice description: "Nucleos turns supplier documents into HMRC returns." That is what the product does. That is enough.

---

## The audit

Once all six pieces are in place, the brand needs to be audited across every page and every viewport width before anything ships. This is not a code review. It is a visual and copy review conducted in a browser: does the mark render correctly at small sizes, does the tagline appear in the right place and nowhere else, are signal colours used only for state, does every piece of copy pass the voice test.

The audit exists because implementation and intention diverge. Code that is correct in isolation can produce a result that is wrong in context. The audit catches that. It runs last because it requires everything to be in place — and it is the gate, not a formality.

---

## Summary

| What | Why |
|---|---|
| Brand tokens in design system | Single source of truth for identity constants |
| Mark as SVG component | The brand idea made visible; rules enforced in code |
| Navigation bar | Highest-leverage touchpoint — appears on every page |
| Favicon and metadata | Browser-level brand presence; voice in non-visual contexts |
| Homepage logotype and tagline | The tagline earns its place only after the number |
| Auth pages logotype | Recognition signal at the conversion moment |
| Footer component | Brand consistency on the most neglected touchpoint |
| Brand audit | The gap between intention and implementation, closed |
