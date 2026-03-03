#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export PYTHONPATH="${REPO_ROOT}:${REPO_ROOT}/nucleo-ledger"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

# If RELOAD is set to "0", disable reload. Otherwise default to reload.
if [ "${RELOAD:-1}" = "0" ]; then
  exec uvicorn ledger_app.main:app --host "$HOST" --port "$PORT"
else
  exec uvicorn ledger_app.main:app --host "$HOST" --port "$PORT" --reload
fi
