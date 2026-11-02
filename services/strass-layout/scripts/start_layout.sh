#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# RS-3043: the port comes from LAYOUT_PORT, default 8001. Not 8000: on the iMac PatternNifty's own
# strass service uses 8000.
PORT="${LAYOUT_PORT:-8001}"
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "LAYOUT_PORT must be a port number between 1 and 65535 (it is \"$PORT\")." >&2
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  echo "No virtual environment found. Run scripts/setup_mac.sh first." >&2
  exit 1
fi

echo "Tip: to keep the Mac awake during long layouts, start this script as: caffeinate -i scripts/start_layout.sh (npm run studio does this for you)" >&2

. .venv/bin/activate
exec uvicorn app:app --host 127.0.0.1 --port "$PORT" --workers 1
