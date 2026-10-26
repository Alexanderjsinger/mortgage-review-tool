#!/usr/bin/env bash
# Mortgage Review — local launch.
# Sets up everything the first time, then just starts the server on repeat runs.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8787}"

if [ ! -d node_modules ]; then
  echo "→ Installing dependencies (one time)…"
  npm install --no-audit --no-fund
fi

if [ ! -f .dev.vars ]; then
  echo "→ Creating .dev.vars with a local password and a random session secret…"
  SECRET="$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  PASSWORD="${ADVISOR_PASSWORD:-devpass}"
  printf 'ADVISOR_PASSWORD=%s\nSESSION_SECRET=%s\n' "$PASSWORD" "$SECRET" > .dev.vars
  echo "   Sign-in password: $PASSWORD  (change it in .dev.vars anytime)"
fi

if [ ! -d .wrangler/state ]; then
  echo "→ Creating the local database…"
  npx wrangler d1 execute mortgage-reviews --local --file=schema.sql >/dev/null
fi

echo
echo "→ Starting on http://127.0.0.1:$PORT   (Ctrl-C to stop)"
echo "   Password is in .dev.vars"
echo
exec npx wrangler dev --port "$PORT" --ip 127.0.0.1
