#!/usr/bin/env bash
# Stop hook: run the project's verifier when a turn completes, and feed any
# failure back so Claude fixes it before handing control back (the CompPilot
# feedback-loop idea from arXiv 2511.00592 — close the loop with an *external*
# ground-truth checker rather than the model's self-assessment).
#
# A UserPromptSubmit invocation snapshots project content before the model runs.
# The Stop invocation verifies only when tracked or non-ignored untracked content
# changed outside Markdown files, so read-only, commit-only, and documentation-only
# turns do not run project checks.
#
# Bounded retries: instead of verifying exactly once and then letting any state
# through (the old `stop_hook_active` short-circuit, which meant a *wrong* fix
# still passed), the hook allows up to MAX_ROUNDS verify->fix rounds, tracked by
# a per-session counter file. On the final round it tells Claude to surface the
# remaining failure rather than loop; past the cap it stops trapping the turn so
# it can never spin forever.
#
# Verifier resolution (per-project, optional), in precedence order:
#   1. ${CLAUDE_PROJECT_DIR}/.agent/verify.sh   -> verify.sh
#   2. a `verify` task in Taskfile.yml/.yaml    -> task verify
# Both paths are harness-neutral on purpose: pi's verify-turn extension resolves
# the same two, so one project-level verifier serves both harnesses.
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

# Resolve the verifier before fingerprinting so globally installed hooks remain
# cheap no-ops in projects that have not configured project checks.
label=""
declare -a verifier_command=()
verify_sh="${project_dir}/.agent/verify.sh"
if [[ -x "$verify_sh" ]]; then
  label=".agent/verify.sh"
  verifier_command=("$verify_sh")
elif command -v task >/dev/null 2>&1; then
  taskfile=""
  [[ -f "${project_dir}/Taskfile.yml" ]] && taskfile="${project_dir}/Taskfile.yml"
  [[ -z "$taskfile" && -f "${project_dir}/Taskfile.yaml" ]] && taskfile="${project_dir}/Taskfile.yaml"
  if [[ -n "$taskfile" ]] && task --taskfile "$taskfile" --list-all 2>/dev/null | grep -qE '^\* verify:'; then
    label="task verify"
    verifier_command=(task verify)
  fi
fi
[[ -z "$label" ]] && exit 0

session_id=$(echo "$input" | jq -r '.session_id // "nosession"')
session_key=${session_id//[^A-Za-z0-9_-]/_}
counter="${TMPDIR:-/tmp}/claude-verify-${session_key}"
baseline="${TMPDIR:-/tmp}/claude-verify-baseline-${session_key}"
fingerprint_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/project-content-fingerprint.py"
current_snapshot=""
if command -v python3 >/dev/null 2>&1 && [[ -f "$fingerprint_script" ]]; then
  current_snapshot=$(python3 "$fingerprint_script" "$project_dir" "$baseline" 2>/dev/null || true)
fi
current_fingerprint=$(printf '%s' "$current_snapshot" | jq -r '.fingerprint // empty' 2>/dev/null || true)
change_scope=$(printf '%s' "$current_snapshot" | jq -r '.changeScope // "unknown"' 2>/dev/null || true)

if [[ "${1:-}" == "snapshot" ]]; then
  if [[ -n "$current_fingerprint" ]]; then
    printf '%s\n' "$current_snapshot" > "$baseline"
  else
    rm -f "$baseline"
  fi
  exit 0
fi

rounds=0
[[ -f "$counter" ]] && rounds=$(cat "$counter" 2>/dev/null || echo 0)
[[ "$rounds" =~ ^[0-9]+$ ]] || rounds=0

if (( rounds == 0 )) && [[ "$change_scope" == "unchanged" || "$change_scope" == "markdown-only" ]]; then
  exit 0
fi

out=""
status=0
out=$(cd "$project_dir" && "${verifier_command[@]}" 2>&1); status=$?

# Passed: remember this content, clear the counter, and let the turn end.
if [[ "$status" -eq 0 ]]; then
  [[ -n "$current_fingerprint" ]] && printf '%s\n' "$current_snapshot" > "$baseline"
  rm -f "$counter"
  exit 0
fi

# Failed: bump the round counter. Active repair rounds always rerun the verifier,
# even when the model did not manage to change project content.
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
