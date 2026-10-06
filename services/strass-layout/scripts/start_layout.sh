#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -x .venv/bin/python ]; then
  echo "No virtual environment found. Run scripts/setup_mac.sh first." >&2
  exit 1
fi

echo "Tip: to keep the Mac awake during long layouts, start this script as: caffeinate -i scripts/start_layout.sh" >&2

. .venv/bin/activate
exec uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1
