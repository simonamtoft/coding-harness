#!/usr/bin/env bash
# Regression runner for check-bash.sh.
#
#   bash hooks/test/run.sh [path-to-hook]
#
# Feeds Claude-specific cases plus the shared command-safety contract to the
# hook as a PreToolUse payload and asserts the verdict. Defaults to ../check-bash.sh; pass a path to test a
# candidate rewrite without installing it (avoids locking yourself out of Bash).
# Shared `permit` cases may be auto-allowed or deferred; they must never deny.

set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
hook="${1:-$here/../check-bash.sh}"
cases=("$here/cases.tsv" "$here/../../../shared/command-safety.tsv")

[[ -f "$hook" ]]  || { echo "no such hook: $hook" >&2; exit 1; }
for case_file in "${cases[@]}"; do
  [[ -f "$case_file" ]] || { echo "no such fixture: $case_file" >&2; exit 1; }
done

# The hook resolves relative paths against $PWD (rm-scope, managed-script and
# secret-path checks), so pin it to the repo root for reproducibility.
cd "$here/../.." || exit 1

pass=0; fail=0
declare -a failures=()

for case_file in "${cases[@]}"; do
  while IFS=$'\t' read -r expected cmd; do
    [[ -z "${expected:-}" || "$expected" == \#* ]] && continue
    [[ -z "${cmd:-}" ]] && continue

    payload=$(jq -nc --arg c "$cmd" '{tool_input:{command:$c}}')
    # Unset the bypass so a session that exported it can still run the suite.
    out=$(CLAUDE_HOOK_DISABLE= HOME=/Users/example bash "$hook" <<<"$payload" 2>/dev/null)
    rc=$?

    if   (( rc == 2 ));                                    then actual="deny"
    elif (( rc != 0 ));                                    then actual="error($rc)"
    elif [[ "$out" == *'"permissionDecision":"allow"'* ]];  then actual="allow"
    else                                                        actual="defer"
    fi

    if [[ "$expected" == "permit" ]]; then
      [[ "$actual" != "deny" && "$actual" != error\(* ]] && passed=1 || passed=0
    elif [[ "$actual" == "$expected" ]]; then
      passed=1
    else
      passed=0
    fi

    if (( passed )); then
      (( pass++ ))
    else
      (( fail++ ))
      failures+=("expected=$expected actual=$actual  |  $cmd")
    fi
  done < "$case_file"
done

if (( fail )); then
  printf '\n%s\n' "FAILURES ($fail):"
  printf '  %s\n' "${failures[@]}"
fi
printf '\n%d passed, %d failed (hook: %s)\n' "$pass" "$fail" "$hook"
(( fail == 0 ))
