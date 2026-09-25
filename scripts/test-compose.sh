#!/usr/bin/env bash
set -euo pipefail

project=order-api-p0-acceptance
compose=(docker compose -p "$project" --profile test)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans
}

cleanup
trap cleanup EXIT
"${compose[@]}" up --build --abort-on-container-exit --exit-code-from test test
