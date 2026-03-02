./venv/bin/python -m uvicorn ledger_app.main:app --port 8000

#!/usr/bin/env bash
set -euo pipefail

PYTHONPATH=. uvicorn ledger_app.main:app \
  --host 127.0.0.1 \
  --port "${PORT:-8000}" \
  --reload
