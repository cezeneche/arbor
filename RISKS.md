# Risks and resolved blockers

`INTEGRATION-PLAN.md` cites this file. It did not exist in either repo or in any
commit, so it is being reconstructed from the plan's inline references as each
item is resolved. Items still carrying their original numbering from the plan
are marked with it.

---

## Resolved

### #6 — Has any Nucleos audit chain entry backed a filed declaration, or been shown to a supplier or auditor?

**No.** Answered by the owner on 2026-08-09.

Corroborated by production (read-only query, same date):

| | |
|---|---|
| `cbam.audit_log` rows | 10, across 5 distinct cases |
| Audit window | 2026-05-11 to 2026-05-25 |
| `cbam.cbam_snapshots` | 0 rows |
| Cases | 72 (64 draft, 4 approved, 4 error) |

Ten audit events over a fortnight, no snapshots, and nothing since May is the
shape of a system that has been exercised in development and never relied upon.

**Unblocks Phase 4** on the first branch: rebuild the chain in Arbor and import
the Nucleos entries as a sealed historical block with an explicit origin marker,
preserving original timestamps. The second branch — sealing the old chain and
hashing its final state into Arbor's first entry — is not required.

### #12 / F3 — Was `LLAMA_CLOUD_API_KEY` ever set in production? Did supplier documents leave the infrastructure?

**No, and they could not have.**

`LLAMA_CLOUD_API_KEY`, `LlamaParse` and `llama_parse` have never appeared in any
commit in the repository's history (`git log --all -S`). No code path reads such
a key, `render.yaml` does not declare one, and `llamaindex_service.py` used a
local FastEmbed model rather than a cloud call. `llama-parse` and `llama-cloud`
were dependency entries with no caller.

There is no disclosure question. The dependencies have been removed.

### F4 — Had any case already been deleted in production?

**No.** Read-only query, 2026-08-09:

- Audit rows whose case no longer exists: **0**
- Snapshots whose case no longer exists: **0**
- Audit events matching delete / remove / purge: **0**

**No pre-existing gaps to document.** Phase 4 imports a continuous chain.

---

## Open

### #4 — Free allocation 2033: 12.5% in code against 14% in CBAM-reg.md

**Resolved, and wider than reported.** Verified against Directive 2003/87/EC
Article 10a(1a) as amended by Directive (EU) 2023/959: the schedule is 39%
(2031), 26.5% (2032), 14% (2033). The code held 38.5%, 25.5% and 12.5% — three
wrong years, not one. Corrected under F6 and pinned in
`golden/cases/calculation/free_allocation_full_schedule.json`.

### #5 — Golden test set

**Built.** 17 cases, `golden/`, run with `pytest -m golden`. Covers the live
extraction path, all four previously untested parsers, emissions method
selection, the mark-up table, the Article 10a(1a) schedule and the HMRC return.
Verified to detect injected regressions rather than merely passing.

### #8 — The four dormant parsers — RESOLVED

**All four wired in** on the owner's instruction, behind the single text-in
entry point. Format parsers (XML, CSV) are authoritative and stand alone; the
customs parser competes through the arbiter against the regex layer.
Previously: Customs, mill certificate, spreadsheet and XML
declaration parsers had **zero tests and zero call sites**. Their current
behaviour is now frozen in the golden set, so wiring them in or deleting them
are both safe to do deliberately.

### #9 — The tier collision

**Resolved by renaming.** Nucleos uses `emissions_method`
(`actual | estimated | default`); the EU 2023/1773 Art. 4 tier numbering is kept
only as a `regulation_tier` citation field. UI copy says "Emissions method".

### #2 — Supplier request contract

Unchanged. Nucleos's three-field submission contract is not Arbor's
`DataRequest` shape and must not reuse its answer-assembly logic.

### #3 — `cpr_calculator.py` mixed pure functions with `Connection`-taking ones — RESOLVED

The three `_db` functions moved to `cpr_repository.py`. Nothing changed but the
file they live in, and the golden set passed unchanged. That split is what lets
the calculation run as a pure service behind `POST /internal/calculate`.

Exchange rates and qualifying schemes are now versioned reference data in
`cpr_reference.py`, insert-never-update like the Annex VI table. They are facts
about the world every tenant shares, not tenant data.

### #10 — `BackgroundTasks` / `threading.Timer` pipeline in `drafts.py` — RESOLVED

**Removed, not wrapped.** The upload endpoint, the stub-processing-case dance,
the background pipeline and its watchdog timer are all deleted. Arbor's Inngest
queue does this work now, so the anti-pattern had nothing left to guard.

---

## New — found during the fix phase and Phase 1

### N1 — Multi-line invoices silently dropped goods lines — FIXED

`_extractor.py` merged Claude's line items **only when the deterministic layer
found zero lines**. When regex extracted one line of a two-line invoice, Claude's
complete set was discarded and the remaining lines never reached the
declaration. Nothing flagged the omission, and a short declaration looks exactly
like a complete one.

**Fixed.** The merge is now a union. Deterministic lines are never modified —
that invariant is what makes the hybrid trustworthy — but they no longer
suppress the rest of the document. A validated Claude line is added when the
deterministic layer does not already have it, matched on (CN code, mass).

Every addition is flagged, and so is any disagreement about line count:

| Flag | Meaning |
|---|---|
| `claude_line_added_beyond_deterministic` | a line the deterministic layer missed |
| `claude_line_same_cn_different_mass` | same product, different mass — a second consignment, or the two extractors disagreeing |
| `line_count_disagreement` | the two extractors read a different number of lines |

The anti-hallucination checks are unchanged: an added line still has to carry a
valid CN code and a positive mass, both evidenced verbatim in the source text.

Covered by `api/tests/ledger/test_line_merge_and_origin.py`. Not in the golden
set, because exercising the merge needs a Claude response and a live model call
is not reproducible.

### N2 — `origin_country` missed the common phrasing — FIXED

The live extraction regex matched `origin country` only. Commercial invoices and
customs Box 34 say *country of origin*, which returned null. The customs parser
handled both spellings; the live path did not. Origin country determines CBAM
scope and the electricity factor.

**Fixed.** Both phrasings are matched, the separator is optional, and the code
must stand alone — a trailing boundary stops "Turkey" being read as the ISO code
"TU". Pinned in `golden/cases/extraction/invoice_steel_two_lines.json`.

### N3 — Mill certificate route inference could not select EAF — FIXED

`_extract_chemical_composition` upper-cases element symbols (`CR`, `NI`) while
`_infer_production_route` read `composition.get("Cr")` and `("Ni")`. Those
lookups always returned 0.0, so the EAF branch was unreachable for every
document. Annex VI defaults are differentiated by production route.

### N4 — Two chain verifiers had drifted

`audit_signer.verify_chain` and a near-duplicate inside `api/audit.py` both
implemented the chain guarantee, against different column names
(`hmac_sha256`/`prev_hmac` versus the production `signature`/`chain_hash`). Only
one gained the gap-versus-tamper distinction. **Resolved:** `api/audit.py` now
adapts the column names and delegates to the single verifier, and the endpoint
returns `chain_tampered` and `chain_gaps`.

### N6 — Thousand-separated masses parsed as thousandths — FIXED

The deterministic extraction layer read `Net mass: 24,500.00 kg` as **24.0**.
It stopped at the separator.

| Input | Parsed |
|---|---|
| `24500 kg` | 24500.0 |
| `24500.00 kg` | 24500.0 |
| `24,500 kg` | **24.0** |
| `24,500.00 kg` | **24.0** |
| `24 500 kg` | **24.0** |

A thousand-fold under-declaration, on the live path. Thousand
separators are the normal way masses are written on commercial invoices and
customs declarations, so this is the common case rather than an edge one.

Nothing downstream caught it. 24 kg of steel is a plausible quantity, so no
plausibility check fired, and the emissions figure that followed was wrong in
proportion. The mass also feeds the mark-up and the CBAM charge.

**Fixed** on the owner's instruction, 2026-08-09. `parse_quantity` now decides
which separator is the decimal point — the rightmost one that could be — and
both mass regexes accept separators instead of stopping at the first comma. The
old shared parser stripped every comma unconditionally, so the European `24,5`
became 245; that is fixed in the same change.

One case is genuinely undecidable: a lone separator followed by exactly three
digits. `24,500` is 24500 in the UK and 24.5 in Germany. It is read as thousands
— the dominant convention on trade documents — and `parse_quantity` returns
`ambiguous=True` so a caller can flag it rather than present a guess as a reading.

Pinned in `golden/cases/extraction/mass_thousand_separator.json` and covered by
`api/tests/ledger/test_number_parsing.py`.

### N7 — The customs parser could not extract an MRN or a net mass — FIXED

`_MRN_RE` required `[0-9]{2}[A-Z]{2}[0-9A-Z]{14}[A-Z][0-9]` — twenty characters.
A Movement Reference Number is eighteen. No genuine MRN matched, so
`entry_reference` was always `None`. The code comment beside the pattern says
"standard 18-char MRN", so the intent and the regex disagree.

`_extract_net_mass_kg` returns `None` for `Box 35 Net mass: 24,500.00 kg`.

**Both fixed.** The MRN pattern is now the correct 18 characters, and the mass
capture must begin and end with a digit — the class previously admitted
whitespace alone, so `Box 35 Net mass: 24,500.00 kg` satisfied the pattern on the
Box-35 keyword with a single space as the value.

Pinned in `golden/cases/parsers/customs_sad_complete.json`.

### N8 — Mill certificate heat numbers extracted as the word "number" — FIXED

`_HEAT_RE` alternates `(?:heat|charge|cast|melt|heat\s+no\.?|charge\s+no\.?)`.
Python takes the first branch that matches, so `heat` always wins and the longer
branches are unreachable. On `Heat number: A4471928` the capture group then takes
the following word, giving `heat_number = "number"`.

**Fixed.** The keyword now takes an optional `number` / `no.` / `#` which is
skipped rather than captured, and the value must contain a digit so the pattern
cannot capture a following word. Frozen in
`golden/cases/parsers/mill_cert_bf_bof.json`.

### N5 — Production audit schema diverges from the migrations — RESOLVED

Two audit tables exist in production, with different schemas and different
histories. Read-only query, 2026-08-10:

| Table | Columns | Rows |
|---|---|---|
| `cbam.audit_log` | `signature`, `chain_hash`, `payload`, `actor` | **10** |
| `public.audit_log` | `hmac_sha256`, `prev_hmac`, `event_json`, `actor_sub` | 1 |

**`cbam.audit_log` is authoritative.** It is the table the application writes to
and reads from, and it holds every real event.

Migration `004_audit_chain.sql` alters an unqualified `audit_log`, which resolves
to `public.audit_log` — so it added `prev_hmac` to the table nobody uses. That is
why production's `cbam.audit_log` appears to have no chain columns: it has
`chain_hash`, which serves the same purpose under a different name and is
populated normally.

The chain therefore works; only the migration was pointed at the wrong table. The
column-name divergence is bridged by the adapter added under N4, so there is one
verifier and one guarantee.

Actions:

- Migration 004 is dead. Re-point it at `cbam.audit_log` or retire it, but do not
  leave it looking applied when it is not.
- `public.audit_log`'s single row predates the CBAM schema. **Phase 4 imports
  from `cbam.audit_log` only**, and records that row as an out-of-scope legacy
  artifact rather than silently folding it into the chain or silently dropping it.
