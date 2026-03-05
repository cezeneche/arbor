# Regulatory Table Change-Control Process

This runbook describes how to update the EU regulatory lookup tables when the
European Commission publishes new values in the Official Journal (OJ).

Affected tables:
- **Annex VI** — Default Specific Embedded Emissions (SEE) per CN code and sector
  → `nucleo-ledger/ledger_app/services/cbam_emission_factors.py`
- **TARIC / Annex I** — CN codes in scope of CBAM by sector
  → `nucleo-ledger/ledger_app/services/cbam_taric.py`

---

## When to run this process

| Trigger | Typical cadence |
|---|---|
| European Commission publishes updated Annex VI default values | Annual (OJ, usually Q3) |
| New CN codes added to or removed from CBAM scope (Annex I) | Annual or legislative change |
| Material error correction published in the OJ | As-needed |

Monitor: https://eur-lex.europa.eu (search "CBAM" + "Implementing Regulation")

---

## Step-by-step procedure

### 1. Identify the change

Locate the new OJ reference:
- Publication: *Commission Implementing Regulation (EU) YYYY/NNNN*
- OJ reference: *OJ L NNN, DD.MM.YYYY*
- Note: the effective date (usually 1 October of publication year)

### 2. Update the data

**For Annex VI changes (`cbam_emission_factors.py`):**

1. Edit `_ANNEX_VI` — update `DefaultSEE` entries (direct/indirect tCO2e/t values).
2. Update `TABLE_VERSION`:
   ```python
   TABLE_VERSION = "2024"   # or the new regulation year
   ```
3. Update `FACTOR_METADATA` fields (`regulation`, `oj_reference`, `effective_date`).
4. The `table_sha256` in `FACTOR_METADATA` **auto-recomputes at import time** — no manual update needed.

**For Annex I changes (`cbam_taric.py`):**

1. Edit `_HEADING_TO_SECTOR` and/or `_CN8_TO_SECTOR` to add/remove/reclassify codes.
2. Update `TARIC_TABLE_VERSION`:
   ```python
   TARIC_TABLE_VERSION = "2024-956-AnnexI"   # bump year
   ```
3. Update `TARIC_METADATA` fields (`regulation`, `oj_reference`, `effective_date`).
4. The `sha256` in `TARIC_METADATA` **auto-recomputes at import time**.

### 3. Run tests

```bash
cd /path/to/scope3-agentic-platform
pytest                # must remain green
```

If tests fail, check for:
- Hard-coded factor values in test fixtures that reference the old `TABLE_VERSION`
- `validate_against_defaults()` thresholds that rely on specific SEE magnitudes

### 4. Verify SHA auto-update

```bash
python3 -c "
from nucleo-ledger.ledger_app.services.cbam_emission_factors import FACTOR_METADATA
from nucleo-ledger.ledger_app.services.cbam_taric import TARIC_METADATA
print('Annex VI SHA:', FACTOR_METADATA['table_sha256'])
print('TARIC SHA   :', TARIC_METADATA['sha256'])
"
```

Record both SHA values in the commit message for traceability.

### 5. Tag and commit

```bash
git add nucleo-ledger/ledger_app/services/cbam_emission_factors.py \
        nucleo-ledger/ledger_app/services/cbam_taric.py

git commit -m "reg-table-update: Annex VI + TARIC tables updated to OJ L NNN, DD.MM.YYYY

TABLE_VERSION: 2023 → 2024
Annex VI SHA: <old_sha_prefix>... → <new_sha_prefix>...
TARIC SHA   : <old_sha_prefix>... → <new_sha_prefix>...

Regulation: Commission Implementing Regulation (EU) YYYY/NNNN
OJ reference: OJ L NNN, DD.MM.YYYY
Effective date: YYYY-10-01"

git tag reg-table-update/YYYYMM
git push && git push --tags
```

### 6. Build and deploy with git SHA

```bash
export GIT_SHA=$(git rev-parse --short HEAD)
docker compose build --build-arg APP_GIT_SHA=$GIT_SHA
docker compose up -d
```

The `APP_GIT_SHA` is embedded in every calculation snapshot's `algo_versions` and
in the `GET /api/cbam/regulatory-tables` response.

### 7. Verify in production

```bash
curl https://<ledger-host>/api/cbam/regulatory-tables | python3 -m json.tool
```

Expected response includes updated `table_version`, `oj_reference`, `sha256`, and
the new `platform.git_sha`.

---

## What happens to existing calculations?

Existing snapshots are **immutable** — they retain the old `table_version` and
`sha256` embedded at calculation time. This is intentional and correct:

- A 2023-era calculation that used `TABLE_VERSION = "2023"` is permanently linked
  to that version in its `calculation_v1` snapshot.
- A new calculation after the update uses `TABLE_VERSION = "2024"`.
- Auditors can compare the two by inspecting the `algo_versions.emission_factor_table`
  field in each snapshot.

Do **not** retroactively mutate existing snapshots.

---

## Rollback

If a table update contains an error:

1. Revert the data file changes: `git revert <commit>`
2. Re-run tests
3. Tag: `git tag reg-table-rollback/YYYYMM`
4. Rebuild and redeploy with the reverted SHA

Calculations performed between the bad update and the rollback will have the
incorrect `TABLE_VERSION` in their snapshots. Document this period in your
compliance records and recalculate affected cases using the correct table version.

---

## Contacts

| Role | Responsibility |
|---|---|
| Regulatory officer | Monitors OJ publications, initiates the update |
| Engineering lead | Performs code change, runs tests, deploys |
| Compliance auditor | Verifies SHA checksums post-deployment via `/api/cbam/regulatory-tables` |
