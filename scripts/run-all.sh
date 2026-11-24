#!/usr/bin/env bash
# Runs the whole measurement locally: three runs, each on a fresh local D1
# with its seed, `wrangler dev` with METRICS=1, then measure.mjs. Linux only.
# Usage: scripts/run-all.sh [n] [repeats]
set -euo pipefail
cd "$(dirname "$0")/.."
N=${1:-400}
REPEATS=${2:-3}
PORT=8797
export ADMIN_TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '=+/' )
printf 'ADMIN_TOKEN=%s\n' "$ADMIN_TOKEN" > .dev.vars
mkdir -p results

if ss -ltn | grep -q ":$PORT "; then echo "port $PORT is busy" >&2; exit 1; fi

# label, seed shape, STATS_MODE, extra measure flags
runs=(
  "totals totals totals"
  "naive raw naive"
  "pipeline raw totals --pipeline 1"
)
for run in "${runs[@]}"; do
  read -r label shape mode extra <<< "$run"
  rm -rf .wrangler/state
  npx wrangler d1 migrations apply DB --local > "results/setup-$label.log" 2>&1
  node scripts/seed.mjs --shape "$shape" --out seed.sql > "results/seed-$label.json"
  npx wrangler d1 execute DB --local --file seed.sql --yes >> "results/setup-$label.log" 2>&1
  setsid npx wrangler dev --port $PORT --ip 127.0.0.1 --var METRICS:1 --var STATS_MODE:$mode > "results/dev-$label.log" 2>&1 &
  DEV=$!
  trap 'kill -- -"$DEV" 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/healthz" > /dev/null && break; sleep 1; done
  # shellcheck disable=SC2086
  node scripts/measure.mjs --base "http://127.0.0.1:$PORT" --label "$label" --n "$N" --repeats "$REPEATS" $extra
  kill -- -"$DEV"
  wait "$DEV" 2>/dev/null || true
  sleep 2
done
rm -f .dev.vars seed.sql
node scripts/summarize.mjs results/measure-totals.json results/measure-naive.json results/measure-pipeline.json > results/summary.md
node scripts/budget.mjs results/measure-totals.json --rollup results/measure-pipeline.json > results/budget-example.md
cat results/summary.md results/budget-example.md
