#!/usr/bin/env bash
set -euo pipefail

PYTHONPATH=. uvicorn narrative_app.main:app \
  --host 127.0.0.1 \
  --port "${PORT:-8001}" \
  --reload
