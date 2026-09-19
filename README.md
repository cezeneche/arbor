# Arbor

A certified operational data repository. Manufacturers, suppliers and producers
upload operational documents; Arbor extracts the figures, has a person confirm
them, and stores each one with its source, a trust tier (Verified, Declared or
Estimated) and an HMAC-chained audit entry. Buyers request, query and share that
data. CBAM cases are opened from confirmed customs documents and handled by the
Nucleos engine in `nucleos/`.

## Layout

| Path | What it is |
|---|---|
| `src/` | The Next.js app (App Router), TypeScript, Prisma, Postgres |
| `prisma/` | Schema and migrations |
| `nucleos/` | The CBAM engine (FastAPI, Python) and its legacy front ends |
| `brain/` | Stateless maths service (calibration, fusion, privacy) — Python |
| `contract/` | The Arbor–Nucleos contract; TypeScript is generated from it |
| `docs/` | Deployment, integration rollout, security (WISP, risk register, incident response) |

## Running it

```sh
npm ci
cp .env.example .env        # fill in the values
npm run dev
```

## Checking it

```sh
npx tsc --noEmit && npx eslint src && npx jest     # Arbor
npm run python:setup                                # once: creates nucleos/.venv
npm run test:python                                 # Nucleos (set TEST_DATABASE_URL for Postgres — see nucleos/scripts/create_test_db.sh)
npm run contract:check && npm run verify:boundary   # Arbor–Nucleos contract and HTTP boundary
```

CI runs all of these on every pull request.

## Deploying

Migrations are applied as a separate, deliberate step before the deploy that
needs them — never by the build. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
The Nucleos rollout and its open items are in
[docs/INTEGRATION-ROLLOUT.md](docs/INTEGRATION-ROLLOUT.md).

## Rules

`CLAUDE.md` holds the architecture rules (three layers, trust tiers, design
system) and the deployment gate.
