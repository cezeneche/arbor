# Disaster Recovery Runbook — scope3-agentic-platform

## RTO / RPO Targets

| Target | Value |
|--------|-------|
| RPO (Recovery Point Objective) | ≤ 24 hours (daily automated backup) |
| RTO (Recovery Time Objective) | ≤ 2 hours (restore + verify + restart) |

Reduce RPO by scheduling `scripts/backup.py` more frequently (e.g. every 6 hours via cron).

---

## Automated Backups

Backups run via the `backup` service in `docker-compose.yml` every 24 hours:

```
pg_dump → gzip → S3 (s3://${S3_BUCKET}/backups/)
```

Backups older than `BACKUP_RETAIN_DAYS` (default 30) are automatically purged.

### List available backups

```bash
python scripts/backup.py --list
```

### Run an on-demand backup

```bash
DATABASE_URL=... S3_ENDPOINT_URL=... S3_ACCESS_KEY=... S3_SECRET_KEY=... \
  S3_BUCKET=scope3-evidence python scripts/backup.py
```

---

## Step-by-Step Restore Procedure

### 1. Identify the target backup

```bash
python scripts/backup.py --list
# Note the S3 key of the backup you want to restore, e.g.:
#   backups/20240301T120000Z.sql.gz
```

### 2. Stop all application services

```bash
docker compose stop ledger narrative
```

> Prevent writes while restoring.

### 3. Restore the database

```bash
# Restore the latest backup:
python scripts/restore.py --latest

# Or restore a specific backup:
python scripts/restore.py --key backups/20240301T120000Z.sql.gz
```

This downloads the backup from S3, decompresses it, and runs `psql` against `DATABASE_URL`.

### 4. Verify the restore

```bash
DATABASE_URL=... python scripts/verify_restore.py
```

Expected output:
```
OK:   Table 'cases' exists.
OK:   Table 'audit_log' exists.
OK:   Table 'documents' exists.
...
Result: 0 failure(s), 0 warning(s).
```

Exit code `0` = pass. Exit code `1` = one or more tables missing.

### 5. Restart services

```bash
docker compose start ledger narrative
```

### 6. Smoke-test the API

```bash
curl -f http://localhost:8000/ready   # ledger health
curl -f http://localhost:8001/health  # narrative health
./scripts/demo_cbam_e2e.sh            # full end-to-end flow
```

---

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL DSN |
| `S3_ENDPOINT_URL` | MinIO / AWS S3 endpoint |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | S3 credentials |
| `S3_BUCKET` | Bucket name (default `scope3-evidence`) |
| `BACKUP_PREFIX` | S3 key prefix (default `backups/`) |
| `BACKUP_RETAIN_DAYS` | Auto-purge after N days (default 30) |

---

## Escalation

If restore fails or `verify_restore.py` exits `1`:

1. Check PostgreSQL logs: `docker compose logs postgres`
2. Check S3 object integrity: `aws s3 ls s3://${S3_BUCKET}/backups/ --recursive`
3. Restore from a previous backup (re-run step 3 with an earlier `--key`)
4. Contact the platform team with the output of `verify_restore.py`
