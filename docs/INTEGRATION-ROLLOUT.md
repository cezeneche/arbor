# Rolling out the Nucleos integration

Four stacked PRs, two Arbor migrations, two Nucleos migrations and one new
service. The order below is not a preference — two of the steps break production
if taken out of sequence.

## Why this is not just "merge the PRs"

`docs/DEPLOYMENT.md` decouples migrations from the build on purpose: a build is
repeatable and disposable, a migration mutates the production database once.
Nothing in CI or the Vercel build runs `prisma migrate deploy`.

PR #85 adds `truncated` and `truncationReason` to `ExtractionJob`. Merging it
deploys a Prisma client that selects those columns. **Until the migration has
run, every query that reads an ExtractionJob fails** — which includes the Review
screen and the extraction pipeline. A rollback does not fix it, because the
deployed code is not the thing that is wrong.

So: migration first, then merge.

## Order

### 1. Arbor migration for #85

```sh
DATABASE_URL=<production> npm run migrate:deploy
```

Applies `20260809120000_extraction_truncation_flag`. Additive — two nullable-ish
columns with a default. Safe to run before the code that uses them, which is the
point of running it first.

### 2. Merge #85

`integration/01-arbor-boundary` → `main`. Deploys the contract, the fail-closed
Nucleos client, document→text and the truncation flags.

Nothing calls Nucleos yet — `NUCLEOS_URL` is unset and the client fails closed on
that, so CBAM-relevant documents will error rather than extract. If that is not
acceptable for the window between this step and step 5, merge #85 and #86
together and set the env vars first.

### 3. Merge #86

`integration/02-nucleos-into-repo`. A source move: Nucleos arrives at `nucleos/`.
No Arbor runtime change, no migration. Vercel ignores the directory (`tsconfig`
and `jest` exclusions, verified on the PR's own preview build).

### 4. Nucleos migrations

Against the Nucleos database, from the repo root:

```sh
psql "$NUCLEOS_DATABASE_URL" -f nucleos/db/migrations/006_append_only_audit.sql
psql "$NUCLEOS_DATABASE_URL" -f nucleos/db/migrations/007_audit_chain_correction.sql
```

006 revokes DELETE on `cbam.audit_log` and `cbam.cbam_snapshots`, including the
default privileges that would otherwise restore it on a table rebuild. Run it
before anything writes, and check the application role still has INSERT.

007 indexes the chain on `cbam.audit_log` and documents the divergence that made
004 a no-op. See `nucleos/RISKS.md` N5.

### 5. Deploy Nucleos on Vercel, and point Arbor at it

Two Vercel projects, both on this repository:

| Project | Root directory | What it is |
|---|---|---|
| `nucleos-api` | `nucleos` | the FastAPI service |
| `nucleos-web` | `nucleos/web` | the tokenised supplier form |

`nucleos/vercel.json` names `api/index.py` as the only build target rather than
letting the runtime discover functions — Nucleos's packages live inside `api/`,
so the default convention would build several hundred functions out of the
service's own modules.

`nucleos-web` exists because `render.yaml` deployed two services, not one, and
the second hosts the public supplier submission page. Dropping Render without it
would take that page down. It is a stopgap: Arbor now serves the same form at
`/supplier/[token]`, so once that is confirmed working against real tokens, this
project can be retired and the emails repointed.

Keep the Render services running until both Vercel projects answer.

**Retiring Render (done last).** Both services are superseded — the API by
Vercel's `nucleos-api`, the web by Arbor's own `/supplier/[token]`. Delete them
only after confirming no unexpired supplier token still points at the old host,
because those links are the one thing Arbor cannot serve in their place. New
links are unaffected: `WEB_BASE_URL` on `nucleos-api` points at Arbor.

`render.yaml` was removed when Render was retired. The two-service topology it
described is recorded above.

Then, in Arbor's environment:

```
NUCLEOS_URL=https://<the nucleos service>
NUCLEOS_INTERNAL_TOKEN=<a token with cbam:read and cbam:write>
```

Both are required. `isNucleosConfigured()` is false without either, and the
client throws rather than degrading — CBAM documents fail visibly instead of
landing in Review looking like documents with no CBAM data in them.

### 6. Prove it

```sh
npm run verify:boundary          # local, 19 checks, no deployment needed
```

Then push one real customs declaration through the live path: upload →
transcription → Nucleos → `ExtractedField` rows → Review. That is the first time
the product has done this end to end.

### 7. Arbor migration for #87, then merge #87 and #88

```sh
DATABASE_URL=<production> npm run migrate:deploy
```

Applies `20260810120000_foreign_chain_seal`. Additive — one new table.

Then merge `integration/03-audit-chain-seal` and `integration/04-cbam-section`.

### 8. Record the Nucleos chain seal

Once #87 is live, seal the Nucleos chain and record it in Arbor. The entries are
not imported; the seal is what makes their absence a documented handover rather
than an unexplained gap. See `nucleos/api/ledger_app/services/chain_seal.py` and
`src/lib/audit/foreign-chain-seal.ts`.

This is a one-time operation and it is idempotent for an identical seal, so it is
safe to re-run. It refuses to overwrite a seal with a different final state.

## What is still open after this

- The four previously dormant parsers are wired in. Keeping them is a decision,
  not a default (`nucleos/RISKS.md` #8).
- Mill-cert route inference has a `p < 0.020` phosphorus threshold that stops
  high-phosphorus stainless reading as EAF. Left alone deliberately: retuning a
  classification heuristic is a different decision from fixing a lookup that
  never worked (`nucleos/RISKS.md` N3).
- The CBAM case screens were built against sample data. Nucleos's production
  database has never ingested a document, so the layout has never been seen with
  a real case in it. Revise after step 6; the presenter module is where that
  revision goes.
