# The golden set

Frozen input/output pairs for the CBAM domain logic.

The Arbor integration moves this engine behind an HTTP boundary, takes document
handling away from it, and rewrites the code around it. None of that is allowed
to change what the engine computes. This directory is the evidence: each case
runs real production code on a fixed input and compares against a committed
result.

It must pass unchanged after every phase.

## Running it

```bash
pytest api/tests/golden          # verify
pytest -m golden                 # same, by marker
```

## When it fails

The default assumption is that the change is wrong, not the golden file.

Each case carries a `why` explaining what it pins and what breaks if that
behaviour moves, and a `versions` stamp recording the engine and regulatory
table versions in force when it was frozen. A figure that moved because a table
was deliberately re-versioned looks different from one that moved because
something broke — check the stamp before assuming either.

## Regenerating

```bash
GOLDEN_UPDATE=1 pytest api/tests/golden
```

This rewrites `expected` and `versions` in place, leaving `name`, `why`,
`adapter` and `input` alone. The rewritten JSON lands in the diff, where it has
to be read and justified in review.

Running it to turn a red suite green is the one thing that makes this directory
worthless. If a case fails and the new output is genuinely correct, say so
explicitly in the change description and update the `why` to explain the new
behaviour.

## What is covered

| Adapter | Covers |
|---|---|
| `live_extraction` | The one extraction path with real traffic, deterministic layer only |
| `customs_declaration` | SAD / C88 / CDS entries |
| `mill_certificate` | EN 10204 3.1 / 3.2 inspection certificates |
| `spreadsheet_csv` | Supplier return spreadsheets and their header spellings |
| `xml_declaration` | EC transitional registry XML, namespaced and not |
| `emissions_selection` | Actual / estimated / default selection and the mark-up |
| `free_allocation` | The Article 10a(1a) phase-out, every year |
| `default_value_markup` | The mark-up table either side of each band boundary |
| `hmrc_return` | The filed UK return, including Carbon Price Relief |

Four of these — customs, mill certificate, spreadsheet, XML — had no tests and
no call sites when the set was written. They are reachable code with no traffic,
which is why the plan treats wiring them in as an open decision. Freezing their
current behaviour is what makes that decision safe to take either way.

## Determinism

A case that can return two answers for the same input pins nothing.

`live_extraction` runs with `ANTHROPIC_API_KEY` removed, which selects the
extractor's own regex-only fallback. What is frozen is the deterministic layer
exactly as production runs it when the model is unavailable. The Claude
gap-fill and merge rules are covered by unit tests instead; their input is not
reproducible, so they cannot be frozen.

Clock-stamped fields are listed in `VOLATILE_KEYS` in `api/tests/golden/adapters.py`
and replaced with `<volatile>`. Keep that list short — every key on it is one
the golden set no longer checks.

## Defects pinned on purpose

Two cases freeze behaviour that is wrong. Plan rule 5 says behavioural changes
during the integration get flagged, not implemented, so these record what the
engine does today and are where a deliberate fix becomes visible.

- `parsers/mill_cert_scrap_residuals` — element symbols are stored upper-cased
  (`CR`, `NI`) but route inference reads `Cr` and `Ni`, so the EAF branch cannot
  fire for any document. Annex VI defaults are differentiated by production
  route, so a wrong hint is a wrong emissions figure.
- `extraction/invoice_steel_two_lines` — the deterministic layer extracts one of
  two goods lines, and Claude's line items are merged only when it finds *zero*.
  A partially-extracted invoice therefore drops its remaining lines silently.
  The same case shows `origin_country` returning null for "Country of origin:",
  which the live regex does not match.
