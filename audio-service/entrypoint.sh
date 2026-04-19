#!/usr/bin/env bash
set -uo pipefail

HLS_DIR="${HLS_DIR:-/hls}"
mkdir -p "$HLS_DIR"

echo "[entrypoint] Starting API server on :8001 …"
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --log-level info
