#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  echo "Missing virtual environment at ${VENV_DIR}."
  echo "Create it first with: python3 -m venv .venv"
  exit 1
fi

"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/pip" install -r "${ROOT_DIR}/nucleo-ledger/requirements.txt"
"${VENV_DIR}/bin/pip" install -r "${ROOT_DIR}/api/requirements.txt"

echo "Installed all dependencies into ${VENV_DIR}"
