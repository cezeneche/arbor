# Arbor Brain

The Python service behind the TypeScript product. It owns the defensible maths
of the 12-upgrade plan (Bayesian calibration, entropy, embeddings, optimal
transport, Merkle/ZK helpers, differential privacy) that have no first-class
TypeScript equivalent. The Next.js app is the product; the brain is the maths.

## Non-negotiable contract

- **Stateless and DB-less.** The brain never reads Arbor's database. Callers pass
  data in and get results out. This is what keeps it out of the write path.
- **Never in the Layer 1/2 critical section.** If the brain is down, ingestion
  and certification degrade (fall back to the raw scalar score); they never block
  or fail because of it. Calibration *fitting* is an offline job.
- **Internal auth, fail closed.** Every non-`/health` request must carry
  `X-Brain-Token: $BRAIN_INTERNAL_TOKEN`. If the token is unset the service
  refuses protected requests (503) rather than serving them open.

## Endpoints

| Method | Path                | Auth | Purpose |
|--------|---------------------|------|---------|
| GET    | `/health`           | none | Liveness probe. |
| POST   | `/calibration/fit`  | yes  | Upgrade 1 — fit calibration map + Brier/ECE/reliability per group. |

`POST /calibration/fit` takes `{ samples: [{ group, score, correct }], bins, min_samples }`
where each sample is one `GroundTruthLabel` row (`score` = confidenceAtExtraction,
`correct` = wasCorrect) tagged with the `group` it calibrates within (a field type
such as `supplier_identity`, or a document class). It returns, per group, the
Brier score, Expected Calibration Error, a reliability diagram, and an isotonic
calibration map (knots the TypeScript ingestion path interpolates — no runtime
dependency on the brain).

The maths lives in [`app/calibration.py`](app/calibration.py) and is pure stdlib
(PAV isotonic regression, ECE, Brier) so it is transparent and auditable.

## Local development

```bash
python3 -m venv .venv
./.venv/bin/pip install -e '.[dev]'
./.venv/bin/python -m pytest tests/ -q         # unit + contract tests
BRAIN_INTERNAL_TOKEN=dev ./.venv/bin/uvicorn app.main:app --reload
```

## Deployment

Deploys as its **own Vercel project** rooted at `brain/` (Python runtime on Fluid
Compute). `api/index.py` exposes the ASGI `app`; `vercel.json` rewrites all paths
to it. Set `BRAIN_INTERNAL_TOKEN` in the project's environment; the same secret is
set on the Next.js project so `src/lib/brain/client.ts` can call it.
