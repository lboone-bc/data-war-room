#!/usr/bin/env bash
# Restarts the wallboard dev server on http://localhost:3000.
# Kills anything already bound to port 3000 (stale/hung `next dev`), makes
# sure Node 20 (see .nvmrc) is active, then starts `npm run dev` in the
# foreground. Ctrl+C stops it like a normal `npm run dev`.
set -euo pipefail

cd "$(dirname "$0")/.."

# Free port 3000 if something (often a hung next-server) is still on it.
PIDS="$(lsof -ti :3000 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  echo "Stopping existing process(es) on :3000 ($PIDS)..."
  kill $PIDS 2>/dev/null || true
  sleep 1
  # Force kill anything that ignored the first signal.
  STILL="$(lsof -ti :3000 2>/dev/null || true)"
  if [ -n "$STILL" ]; then
    kill -9 $STILL 2>/dev/null || true
  fi
fi

# Make sure Node 20 (per .nvmrc) is active, not the system Node.
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  \. "$NVM_DIR/nvm.sh"
  nvm use >/dev/null
fi

echo "Node version: $(node -v)"
echo "Starting dev server..."
exec npm run dev
