#!/usr/bin/env bash
# Live smoke test: charges and refunds 1.00 EUR through the PRODUCTION payments API.
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun scripts/live-charge.ts
