#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_ENV="$DIR/src/frontend/.env.local"
TUNNEL_URL_FILE="$DIR/.tunnel-frontend-url"
TUNNEL_LOG_API=$(mktemp)
TUNNEL_LOG_FE=$(mktemp)

# Track all child PIDs for cleanup
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  rm -f "$TUNNEL_LOG_API" "$TUNNEL_LOG_FE"
  # Clean up stale tunnel state so next run doesn't use dead URLs
  rm -f "$TUNNEL_URL_FILE"
  # Remove .env.local to avoid stale VITE_API_URL pointing to dead tunnel
  rm -f "$FRONTEND_ENV"
  echo "Cleaned up tunnel state files."
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# ── 1. Start API server ──────────────────────────────────────────────
echo "=== Starting API server ==="
cd "$DIR" && npm run api &
PIDS+=($!)
PID_API=$!

# Wait for API to be ready (health check), not just a fixed sleep
echo "Waiting for API to be ready..."
API_READY=false
for i in $(seq 1 30); do
  if curl -sf http://localhost:3002/api/health >/dev/null 2>&1; then
    API_READY=true
    break
  fi
  sleep 1
done

if [ "$API_READY" = false ]; then
  echo "ERROR: API server failed to start within 30s"
  exit 1
fi
echo "API server is ready."

# ── 2. Start both tunnels ────────────────────────────────────────────
echo "=== Starting backend tunnel (localhost:3002) ==="
cloudflared tunnel --url http://localhost:3002 2>"$TUNNEL_LOG_API" &
PID_TUNNEL_API=$!
PIDS+=($PID_TUNNEL_API)

echo "=== Starting frontend tunnel (localhost:5173) ==="
cloudflared tunnel --url http://localhost:5173 2>"$TUNNEL_LOG_FE" &
PID_TUNNEL_FE=$!
PIDS+=($PID_TUNNEL_FE)

# ── 3. Wait for both tunnel URLs ─────────────────────────────────────
echo "Waiting for tunnel URLs..."
BACKEND_URL=""
FRONTEND_URL=""

for i in $(seq 1 30); do
  if [ -z "$BACKEND_URL" ]; then
    BACKEND_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG_API" 2>/dev/null | head -1 || true)
  fi
  if [ -z "$FRONTEND_URL" ]; then
    FRONTEND_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG_FE" 2>/dev/null | head -1 || true)
  fi
  if [ -n "$BACKEND_URL" ] && [ -n "$FRONTEND_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$BACKEND_URL" ] || [ -z "$FRONTEND_URL" ]; then
  echo "ERROR: Could not capture tunnel URLs after 30s"
  echo "--- Backend log ---"
  cat "$TUNNEL_LOG_API" 2>/dev/null || true
  echo "--- Frontend log ---"
  cat "$TUNNEL_LOG_FE" 2>/dev/null || true
  exit 1
fi

# ── 4. Write config files ────────────────────────────────────────────
# Frontend needs to know the backend tunnel URL
echo "VITE_API_URL=$BACKEND_URL" > "$FRONTEND_ENV"

# API needs to know the frontend tunnel URL (for magic links in emails)
echo "$FRONTEND_URL" > "$TUNNEL_URL_FILE"

# Also export APP_URL so the API process uses it directly (no auto-tunnel needed)
export APP_URL="$FRONTEND_URL"

# ── 5. Start frontend dev server (picks up .env.local on startup) ────
echo "=== Starting frontend dev server ==="
cd "$DIR" && npm run frontend &
PID_FRONTEND=$!
PIDS+=($PID_FRONTEND)

echo ""
echo "============================================"
echo "  Backend tunnel:  $BACKEND_URL"
echo "  Frontend tunnel: $FRONTEND_URL"
echo ""
echo "  Landing page:    ${FRONTEND_URL}/?landing=1"
echo "  Dashboard:       ${FRONTEND_URL}"
echo ""
echo "  .env.local:      VITE_API_URL=$BACKEND_URL"
echo "  .tunnel-url:     $FRONTEND_URL"
echo "============================================"
echo ""
echo "All services running. Press Ctrl+C to stop."

wait
