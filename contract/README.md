# The Arbor ↔ Nucleos contract

JSON Schema is the neutral source. Both repos vendor the same schema files and
generate their own language's types from them, so neither side can change the
boundary without the other's drift check failing.

```
contract/schemas/*.json   the source
contract/generate.py      schemas → Pydantic (Nucleos) and TypeScript (Arbor)
contract/DIGEST           sha256 of the schemas, committed in both repos
```

## The boundary

Text and metadata in, structured fields out. **No document blobs cross it, and
no browser reaches Nucleos.** Arbor owns the browser, auth, documents,
document→text extraction, provenance and the audit chain; Nucleos owns
text→CBAM structure, emissions method selection, CPR, free allocation and the
report builders.

A test in each repo fails if any schema declares a field whose name suggests a
blob, a URL or a byte payload. That is how the rule stays true rather than
merely stated.

## The seven payload shapes

| Schema | Direction |
|---|---|
| `cbam-extraction-request` | Arbor → Nucleos |
| `cbam-extraction-result` | Nucleos → Arbor |
| `declaration-payload` | Arbor → Nucleos |
| `calculation-result` | Nucleos → Arbor |
| `cpr-query` | Arbor → Nucleos |
| `cpr-result` | Nucleos → Arbor |
| `supplier-request` | Arbor → Nucleos |

`INTEGRATION-PLAN.md` §7 says "six payload shapes" and then names seven. The
named list is the requirement; the count is wrong. Raised rather than resolved
by dropping one.

## Regenerating

In Nucleos:

```bash
python contract/generate.py --python api/ledger_app/contract/models.py
python contract/generate.py --digest > contract/DIGEST
```

In Arbor:

```bash
npm run contract:generate
```

Changing a schema means: edit it in Nucleos, regenerate the Python, update the
digest, copy `contract/schemas/*.json` and `contract/DIGEST` into Arbor,
regenerate the TypeScript. Both repos' tests then pass again.

## What the drift check does and does not prove

Each repo verifies its own generated types against its own vendored schemas, and
that those schemas hash to the committed digest.

Neither repo can see the other. The digest is what makes divergence visible: a
schema change alters it, so a mismatch between the two repos shows up as a
conflict in review rather than as a runtime shape error months later. Genuine
cross-repo verification would need CI with access to both, which does not exist
yet.

## The generator

It handles the subset of JSON Schema the contract uses — objects with fixed
properties, arrays, named enums, primitives, nullable unions, local `$defs` and
cross-file `$ref` into `common.json` — and raises on anything else.

That strictness is the point. A generator that quietly mishandles a construct
produces types that look right and are not, which is worse than one that
refuses. Inline enums and inline objects must be named in `$defs`; the generator
will tell you so rather than emitting `Record<string, unknown>` and moving on.

## The two axes

`EmissionsMethod` (`ACTUAL | ESTIMATED | DEFAULT`) says which emissions value
entered the calculation. `ProvenanceTier` (`VERIFIED | DECLARED | ESTIMATED`)
says how much to trust a record's origin.

They are orthogonal, neither derives from the other, and both travel on every
goods line. A mill certificate that is `ACTUAL` method and `DECLARED` provenance
is a legitimate, common state.

The reason they must not be merged is written into the schema descriptions
themselves, so it reaches a future engineer through the generated types rather
than through a document nobody opens. Never call the Nucleos axis a tier — the
EU 2023/1773 Art. 4 tier numbering travels as `regulation_tier` on a rejection
reason, and nowhere else.

Nucleos never sets `provenance_tier`. Extraction produces drafts; only a human
action in Arbor's Review screen sets provenance.
