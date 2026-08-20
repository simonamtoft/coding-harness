#!/usr/bin/env bash
# Stop hook: run the project's verifier when a turn completes, and feed any
# failure back so Claude fixes it before handing control back (the CompPilot
# feedback-loop idea from arXiv 2511.00592 — close the loop with an *external*
# ground-truth checker rather than the model's self-assessment).
#
# Runs at the natural "I'm done" boundary, not after every edit, so intermediate
# multi-edit states aren't flagged.
#
# Bounded retries: instead of verifying exactly once and then letting any state
# through (the old `stop_hook_active` short-circuit, which meant a *wrong* fix
# still passed), the hook allows up to MAX_ROUNDS verify->fix rounds, tracked by
# a per-session counter file. On the final round it tells Claude to surface the
# remaining failure rather than loop; past the cap it stops trapping the turn so
# it can never spin forever.
#
# Verifier resolution (per-project, optional), in precedence order:
#   1. ${CLAUDE_PROJECT_DIR}/.claude/verify.sh  -> verify.sh
#   2. a `verify` task in Taskfile.yml/.yaml    -> task verify
# Neither present (or `task` not installed) -> no-op. Default-noop mirrors
# check-edit-scope.sh's default-allow: unrelated repos are unaffected.

set -uo pipefail

MAX_ROUNDS=3

if [[ "${CLAUDE_HOOK_DISABLE:-}" == "1" ]]; then
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

input=$(cat)

project_dir="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$project_dir" ]]; then
  exit 0
fi

# Resolve the verifier to a label + run it. Leaves $label empty if none applies.
label=""
out=""
status=0

verify_sh="${project_dir}/.claude/verify.sh"
if [[ -x "$verify_sh" ]]; then
  label=".claude/verify.sh"
  out=$(cd "$project_dir" && "$verify_sh" 2>&1); status=$?
elif command -v task >/dev/null 2>&1; then
  taskfile=""
  [[ -f "${project_dir}/Taskfile.yml" ]] && taskfile="${project_dir}/Taskfile.yml"
  [[ -z "$taskfile" && -f "${project_dir}/Taskfile.yaml" ]] && taskfile="${project_dir}/Taskfile.yaml"
  if [[ -n "$taskfile" ]] && task --taskfile "$taskfile" --list-all 2>/dev/null | grep -qE '^\* verify:'; then
    label="task verify"
    out=$(cd "$project_dir" && task verify 2>&1); status=$?
  fi
fi

# No verifier in this project -> no-op.
[[ -z "$label" ]] && exit 0

# Per-session round counter (survives across the verify->fix->stop cycle).
session_id=$(echo "$input" | jq -r '.session_id // "nosession"')
counter="${TMPDIR:-/tmp}/claude-verify-${session_id//[^A-Za-z0-9_-]/_}"

# Passed: clear the counter and let the turn end.
if [[ "$status" -eq 0 ]]; then
  rm -f "$counter"
  exit 0
fi

# Failed: bump the round counter.
rounds=0
[[ -f "$counter" ]] && rounds=$(cat "$counter" 2>/dev/null || echo 0)
[[ "$rounds" =~ ^[0-9]+$ ]] || rounds=0
rounds=$((rounds + 1))

# Past the cap: stop trapping so the turn can't loop forever. Claude was asked
# to surface the failure on the final round; don't keep blocking.
if (( rounds > MAX_ROUNDS )); then
  rm -f "$counter"
  echo "Hook: verification still failing after ${MAX_ROUNDS} attempts (${label}); leaving it for the user to resolve." >&2
  exit 0
fi

echo "$rounds" > "$counter"

if (( rounds == MAX_ROUNDS )); then
  echo "Hook: verification failed (${label}) — attempt ${rounds}/${MAX_ROUNDS} (final). If your fix doesn't make it pass, stop and summarize the remaining failure for the user instead of continuing:" >&2
else
  echo "Hook: verification failed (${label}) — attempt ${rounds}/${MAX_ROUNDS}. Fix before finishing:" >&2
fi
echo "$out" >&2
exit 2
