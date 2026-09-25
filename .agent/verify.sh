#!/usr/bin/env bash
# Offline repository checks from the Verification section of AGENTS.md. No model calls: paid
# probes stay manual, and the Pi harness load check runs from .githooks/pre-commit.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

bash -n link.sh
bun test pi/agent/extensions
bash claude/hooks/test/run.sh
bash claude/hooks/test/verify-turn-run.sh
bun test probes/lib probes/test
