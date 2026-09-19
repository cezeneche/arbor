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
npm run python:setup             # once — creates nucleos/.venv
npm run verify:boundary          # local, 23 checks, no deployment needed
```

The boundary check no longer needs a virtualenv that happens to exist on one
machine: it resolves `nucleos/.venv`, or `NUCLEOS_VENV` if you keep yours
elsewhere, and tells you how to make one if you have neither.

It covers the two stateless boundaries — extract and calculate — plus the scope
check and the supplier form. It does **not** cover case creation, because that
writes to the CBAM tables and the check runs against an empty SQLite file with
no schema. Case creation is proven by step 6b, not here.

**6b. One real document.** Push a real customs declaration through the live
path: upload → transcription → Nucleos → `ExtractedField` rows → Review →
Confirm → case → emissions → return. That is the first time the product has
done this end to end, and it is still open.

What changed under it since this was written: confirming a CBAM document now
opens a case (`src/lib/layer2/cbam-handoff.ts`), and three bugs on that path
that only a real Postgres could show were fixed — see "Known state" below.

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

## Known state

Recorded here so the next person does not have to re-derive it.

### Done

- **The standalone `cezeneche/nucleos` repo is archived.** `nucleos/` in this
  repo is the only copy. The old one still carried files deleted in the
  migration (`llama_orchestrator`, `llamaindex_service`,
  `document_text_extractor`, `documents.py`), so an edit landing there would
  have been an edit to a version of the service that no longer runs.
- **`NUCLEOS_URL` and `NUCLEOS_INTERNAL_TOKEN` are in `.env.example`**, with the
  fail-closed behaviour spelled out. They were required and undocumented, which
  on a fail-closed client is a deploy landmine: unset, every CBAM document
  errors and every CBAM screen shows its failure banner.
- **The Python suite runs from the repo root.** `npm run python:setup`,
  `npm run test:python`, `npm run test:all`.

### Update, 19 September 2026

- **#89 (case on confirm) is merged and live.** Its two migrations were applied
  to production on 16 September; `foreign_chain_seal` (step 7) was already there.
- **The old standalone Nucleos Supabase project is gone** (the tenant lookup
  fails), so the migration-lineage question below can only be answered against
  the database `nucleos-api` uses now, whose credentials are in that Vercel
  project's environment.
- **Found while fixing tenant isolation:** `POST /api/cases` (legacy) writes a
  `prev_hmac` column on `public.audit_log` that only one lineage has — more
  evidence the lineages diverge. Not changed.
- **Readiness:** Nucleos `/ready` and `/health/ready` now serve one check
  (database plus the tables a case is written to); Arbor has
  `/api/health/ready`, which also reports the service token's expiry.
- **CI** runs the Nucleos suite against Postgres and gates on the four known
  failures below, each listed with its owning decision in
  `scripts/ci/check-pytest-report.py`.

### Open, and why

- **Step 6b has not been run.** No real document has been through the live path.
  Everything below the extraction boundary has now been exercised against a real
  Postgres by the test suite, but not by a real document through a real deploy.

- **The chain seal (step 8) has not been run.** `scripts/seal-nucleos-chain.mjs`
  and migration `20260810120000_foreign_chain_seal` are both in place. Running it
  needs both production databases; it is idempotent for an identical seal and
  refuses to overwrite a seal with a different final state, so it is safe to run
  as soon as someone has the credentials in front of them.

- **The `nucleos-web` Vercel project is still live**, deliberately. Step 5's own
  condition for retiring it — Arbor's `/supplier/[token]` proven against real
  tokens — depends on step 6b, which has not happened. Unexpired supplier links
  still point at the old host and Arbor cannot serve those. Retire it after 6b,
  not before.

- **Migration lineage — resolved (19 September).** The base lineage
  (`supabase/migration.sql` + `nucleos/db/migrations/`) is canonical. `008` and
  `009` brought across what the application needed from the old second lineage,
  which has been removed. `scripts/migrate.py` and `scripts/create_test_db.sh`
  build identical schemas and policies from it. The production Nucleos database
  still has to be created, from this lineage.

- **The four failing Python tests — resolved (19 September).** The two CPR
  tests needed the CPR tables (now in `008`). The steel happy path exposed a
  kg/t unit bug in the default-emissions helpers, now fixed; the test also now
  verifies its goods line and asks for a UK case. The validation-failure test
  now asserts the 422 where the service blocks. The suite on Postgres is
  1098 passed, 0 failed, 1 live-model skip.

### Bugs this found

Seven, all invisible until the suite met a real database:

1. `cbam.cbam_snapshots` inserts never set `tenant_id`, which is `NOT NULL`.
   Every report package failed its snapshot write, and the route correctly turns
   that into a 503 — so the report package, the compliance pack and both returns
   were unreachable on Postgres.
2. `_require_case_tenant` bound `:tid` and passed `tenant_id`, raising
   `InvalidRequestError` instead of checking anything. The check that stops one
   tenant attaching a shipment to another tenant's case had never run.
3. Shipment, goods-line and emissions inserts never set `tenant_id` either, so
   all three failed the `NOT NULL` constraint. Case creation on confirm would
   have hit this on its first real document.
4. The RLS suite's own connection helper passed SQLAlchemy's
   `postgresql+psycopg2://` DSN straight to `psycopg2.connect`, which rejects it
   — so following the documented instructions produced 26 errors, not 26 passes.
5. `_client_with_fake_engine()` assigned a fake over `ledger_app.api.cbam.engine`
   and never restored it, so every module running after it talked to the fake
   instead of the database. Restored by an autouse fixture in both conftests.
6. The Slack notifier reads `SLACK_WEBHOOK_URL`; the E2E fixtures set and mocked
   `SLACK_INTERNAL_WEBHOOK_URL`, a name nothing else in the repo uses. The
   notifier found no webhook, logged a warning and returned — so the human-review
   alert path had never actually been exercised.
7. `test_case_list_is_scoped_to_tenant` read `body["cases"]` from a response
   shaped `{"items": [...]}`. Its "tenant B must not appear" assertion was
   passing against an empty list, and would have passed just as happily if the
   endpoint had leaked every tenant's cases.

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
