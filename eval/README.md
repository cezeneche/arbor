# Pre-deploy extraction eval gate

A golden-set regression test for the Layer-1 extractor. It re-runs the model
against documents whose correct field values a human has verified once, scores
the result, and **fails the build if a kill-signal field group has regressed**
versus the committed baseline. This is what catches "the model silently got
worse" in CI instead of in a customer's data.

Run it **before bumping `EXTRACTION_MODEL` or `PROMPT_VERSION`** (both in
`src/lib/extraction/extractor-version.ts`).

## Commands

```bash
npm run eval             # gate — non-zero exit if a kill-signal group regressed
npm run eval:baseline    # snapshot the current run as the new committed baseline
```

Both need `ANTHROPIC_API_KEY` in the environment (they call the real model).
The pure scoring logic is unit-tested in the normal suite
(`src/lib/eval/__tests__`); only this runner touches the API, which is why it is
excluded from `npm test`.

## What gates

Only the three **kill-signal** field groups gate a deploy (same taxonomy the live
accuracy monitor watches): `supplier_identity`, `mass`, `emissions_intensity`.
A group fails when either:

- it drops more than `KILL_SIGNAL_MAX_DROP` (5pp) below its baseline, or
- it falls below the absolute floor `KILL_SIGNAL_MIN_ACCURACY` (0.80).

Other field groups are measured and printed but never hold a release.

## Adding a golden case

1. Drop the document in `eval/fixtures/` (PDF, JPEG, or PNG). Use synthetic or
   consented documents — this directory is committed to the repo.
2. Add an entry to `eval/golden-set.json`:

```json
{
  "cases": [
    {
      "id": "electricity-bill-acme-q3",
      "documentType": "ELECTRICITY_BILL",
      "fixture": "electricity-bill-acme-q3.pdf",
      "mediaType": "application/pdf",
      "expected": [
        { "fieldName": "supplier_name", "expectedValue": "Acme Energy Ltd" },
        { "fieldName": "total_consumption_kwh", "expectedValue": "48250" },
        { "fieldName": "vat_number", "expectedValue": null }
      ]
    }
  ]
}
```

`expectedValue: null` asserts the model should find nothing for that field.
Cosmetic differences (case, whitespace, thousands separators, numeric equality)
are **not** counted as misses — the gate reuses the same `valuesMatch` the
calibration loop uses.

3. Run `npm run eval:baseline` once to capture the known-good baseline, review
   the resulting `eval/baseline.json`, and commit it.

## Wiring it into CI

Add a job that runs `npm run eval` on any PR that touches
`src/lib/extraction/**` (or gate it manually before a model/prompt bump). Keep it
off the default test job so ordinary PRs don't spend model tokens.

The gate is a **no-op that passes** while the golden set is empty.
