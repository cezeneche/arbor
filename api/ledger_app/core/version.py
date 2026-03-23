"""
Platform version metadata.

APP_GIT_SHA is injected at Docker build time via:
    docker build --build-arg APP_GIT_SHA=$(git rev-parse --short HEAD) .

APP_VERSION follows semver and is bumped manually on release.

Both are included in every snapshot's algo_versions and in the
GET /api/cbam/regulatory-tables response so that auditors can trace a
calculation back to the exact code that produced it.
"""
from __future__ import annotations

import os

APP_GIT_SHA: str = os.getenv("APP_GIT_SHA", "unknown").strip() or "unknown"
APP_VERSION: str = os.getenv("APP_VERSION", "0.1.0").strip() or "0.1.0"
