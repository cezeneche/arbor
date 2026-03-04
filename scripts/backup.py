#!/usr/bin/env python3
"""
PostgreSQL → gzip → S3 backup script.

Usage:
    python scripts/backup.py            # run a backup now
    python scripts/backup.py --list     # list available backups in S3

Environment variables (required):
    DATABASE_URL        PostgreSQL DSN (postgresql+psycopg2://... or postgres://...)
    S3_ENDPOINT_URL     e.g. http://minio:9000 or https://s3.amazonaws.com
    S3_ACCESS_KEY
    S3_SECRET_KEY
    S3_BUCKET

Optional:
    BACKUP_PREFIX       S3 key prefix  (default: "backups/")
    BACKUP_RETAIN_DAYS  Retention period in days  (default: 30)
"""
from __future__ import annotations

import argparse
import gzip
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone


def _db_dsn() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        sys.exit("DATABASE_URL is required.")
    # Normalise psycopg2 dialect prefix → bare postgres URL for pg_dump
    return url.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgres+psycopg2://", "postgresql://"
    )


def _s3_client():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT_URL") or None,
        aws_access_key_id=os.getenv("S3_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
    )


def run_backup() -> str:
    dsn = _db_dsn()
    bucket = os.getenv("S3_BUCKET", "scope3-evidence")
    prefix = os.getenv("BACKUP_PREFIX", "backups/")
    now = datetime.now(tz=timezone.utc)
    key = f"{prefix}{now.strftime('%Y%m%dT%H%M%SZ')}.sql.gz"

    print(f"[backup] Dumping database to s3://{bucket}/{key} …")

    with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        # pg_dump writes plain SQL
        result = subprocess.run(
            ["pg_dump", "--no-password", "--format=plain", f"--dbname={dsn}"],
            capture_output=True,
            check=True,
        )

        # Compress
        gz_path = tmp_path + ".gz"
        with gzip.open(gz_path, "wb") as gz_f:
            gz_f.write(result.stdout)

        # Upload to S3
        s3 = _s3_client()
        with open(gz_path, "rb") as f:
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=f,
                ContentType="application/gzip",
            )

        size_mb = os.path.getsize(gz_path) / (1024 * 1024)
        print(f"[backup] Uploaded {size_mb:.2f} MB → s3://{bucket}/{key}")

        # Purge old backups
        retain_days = int(os.getenv("BACKUP_RETAIN_DAYS", "30"))
        _purge_old(s3, bucket, prefix, retain_days, now)

    finally:
        for p in (tmp_path, tmp_path + ".gz"):
            try:
                os.unlink(p)
            except FileNotFoundError:
                pass

    return key


def _purge_old(s3, bucket: str, prefix: str, retain_days: int, now: datetime) -> None:
    cutoff = now - timedelta(days=retain_days)
    paginator = s3.get_paginator("list_objects_v2")
    deleted = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["LastModified"].replace(tzinfo=timezone.utc) < cutoff:
                s3.delete_object(Bucket=bucket, Key=obj["Key"])
                deleted += 1
    if deleted:
        print(f"[backup] Purged {deleted} backup(s) older than {retain_days} days.")


def list_backups() -> None:
    bucket = os.getenv("S3_BUCKET", "scope3-evidence")
    prefix = os.getenv("BACKUP_PREFIX", "backups/")
    s3 = _s3_client()
    paginator = s3.get_paginator("list_objects_v2")
    items = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            items.append((obj["Key"], obj["LastModified"], obj["Size"]))
    if not items:
        print("No backups found.")
        return
    items.sort(key=lambda x: x[1], reverse=True)
    print(f"{'Key':<55} {'Last Modified':<26} {'Size (bytes)':>14}")
    print("-" * 100)
    for key, ts, size in items:
        print(f"{key:<55} {str(ts):<26} {size:>14,}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PostgreSQL → S3 backup")
    parser.add_argument("--list", action="store_true", help="List available backups")
    args = parser.parse_args()

    if args.list:
        list_backups()
    else:
        run_backup()
