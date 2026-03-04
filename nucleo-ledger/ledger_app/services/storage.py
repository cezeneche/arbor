import os
from dotenv import load_dotenv
import boto3
from botocore.client import Config

load_dotenv()

S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY")
S3_BUCKET = os.getenv("S3_BUCKET")
S3_REGION = os.getenv("S3_REGION", "us-east-1")

def _validate_storage_config() -> None:
    if not all([S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET]):
        raise RuntimeError(
            "Missing S3/MinIO env vars. Check .env for S3_ENDPOINT_URL, "
            "S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET."
        )

def get_s3_client():
    _validate_storage_config()
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT_URL,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
        config=Config(signature_version="s3v4"),
    )

def s3_healthcheck() -> dict:
    s3 = get_s3_client()
    # Validate bucket exists by listing it
    s3.head_bucket(Bucket=S3_BUCKET)
    return {"s3_ok": True, "bucket": S3_BUCKET}

def upload_text(key: str, content: str) -> str:
    s3 = get_s3_client()
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=content.encode("utf-8"),
        ServerSideEncryption="AES256",
    )
    return f"s3://{S3_BUCKET}/{key}"

def download_bytes(key: str) -> bytes:
    s3 = get_s3_client()
    obj = s3.get_object(Bucket=S3_BUCKET, Key=key)
    return obj["Body"].read()
