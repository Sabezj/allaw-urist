#!/usr/bin/env bash
set -euo pipefail

PYDIR="${PYDIR:-./pysearch_venv}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5051}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set"; exit 1
fi

if [[ ! -d "$PYDIR" ]]; then
  echo "Creating venv at $PYDIR"
  python3 -m venv "$PYDIR"
fi

source "$PYDIR/bin/activate"
pip install --upgrade pip
if [[ -f requirements.txt ]]; then
  pip install -r requirements.txt
fi

export HOST PORT

while true; do
  echo "Starting uvicorn on http://$HOST:$PORT"
  uvicorn main:app --host "$HOST" --port "$PORT" || true
  echo "Restarting in 1s..."
  sleep 1
done