#!/usr/bin/env python3
"""
Restore a PostgreSQL database from a gzipped S3 backup.

Usage:
    python scripts/restore.py --key backups/20240101T000000Z.sql.gz
    python scripts/restore.py --latest          # restore most recent backup

Environment variables:
    DATABASE_URL, S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET
    BACKUP_PREFIX  (default: "backups/")
"""
from __future__ import annotations

import argparse
import gzip
import os
import subprocess
import sys
import tempfile
from datetime import timezone


def _db_dsn() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        sys.exit("DATABASE_URL is required.")
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


def _latest_key(s3, bucket: str, prefix: str) -> str:
    paginator = s3.get_paginator("list_objects_v2")
    items = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            items.append((obj["Key"], obj["LastModified"]))
    if not items:
        sys.exit("No backups found in S3.")
    items.sort(key=lambda x: x[1].replace(tzinfo=timezone.utc), reverse=True)
    return items[0][0]


def restore(key: str) -> None:
    dsn = _db_dsn()
    bucket = os.getenv("S3_BUCKET", "scope3-evidence")
    s3 = _s3_client()

    print(f"[restore] Downloading s3://{bucket}/{key} …")

    with tempfile.NamedTemporaryFile(suffix=".sql.gz", delete=False) as tmp:
        gz_path = tmp.name

    try:
        s3.download_file(bucket, key, gz_path)

        sql_path = gz_path[:-3]
        with gzip.open(gz_path, "rb") as gz_f, open(sql_path, "wb") as sql_f:
            sql_f.write(gz_f.read())

        print(f"[restore] Restoring into database …")
        subprocess.run(
            ["psql", "--no-password", f"--dbname={dsn}", f"--file={sql_path}"],
            check=True,
        )
        print("[restore] Restore complete.")

    finally:
        for p in (gz_path, gz_path[:-3]):
            try:
                os.unlink(p)
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Restore PostgreSQL from S3 backup")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--key", help="S3 object key of the backup to restore")
    group.add_argument("--latest", action="store_true", help="Restore the most recent backup")
    args = parser.parse_args()

    s3 = _s3_client()
    bucket = os.getenv("S3_BUCKET", "scope3-evidence")
    prefix = os.getenv("BACKUP_PREFIX", "backups/")

    key = args.key if args.key else _latest_key(s3, bucket, prefix)
    restore(key)
