#!/usr/bin/env bash
# Regression runner for check-bash.sh.
#
#   bash hooks/test/run.sh [path-to-hook]
#
# Feeds each command in cases.tsv to the hook as a PreToolUse payload and
# asserts the verdict. Defaults to ../check-bash.sh; pass a path to test a
# candidate rewrite without installing it (avoids locking yourself out of Bash).

set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
hook="${1:-$here/../check-bash.sh}"
cases="$here/cases.tsv"

[[ -f "$hook" ]]  || { echo "no such hook: $hook" >&2; exit 1; }
[[ -f "$cases" ]] || { echo "no such fixture: $cases" >&2; exit 1; }

# The hook resolves relative paths against $PWD (rm-scope, managed-script and
# secret-path checks), so pin it to the repo root for reproducibility.
cd "$here/../.." || exit 1

pass=0; fail=0
declare -a failures=()

while IFS=$'\t' read -r expected cmd; do
  [[ -z "${expected:-}" || "$expected" == \#* ]] && continue
  [[ -z "${cmd:-}" ]] && continue

  payload=$(jq -nc --arg c "$cmd" '{tool_input:{command:$c}}')
  # Unset the bypass so a session that exported it can still run the suite.
  out=$(CLAUDE_HOOK_DISABLE= bash "$hook" <<<"$payload" 2>/dev/null)
  rc=$?

  if   (( rc == 2 ));                                    then actual="deny"
  elif (( rc != 0 ));                                    then actual="error($rc)"
  elif [[ "$out" == *'"permissionDecision":"allow"'* ]];  then actual="allow"
  else                                                        actual="defer"
  fi

  if [[ "$actual" == "$expected" ]]; then
    (( pass++ ))
  else
    (( fail++ ))
    failures+=("expected=$expected actual=$actual  |  $cmd")
  fi
done < "$cases"

if (( fail )); then
  printf '\n%s\n' "FAILURES ($fail):"
  printf '  %s\n' "${failures[@]}"
fi
printf '\n%d passed, %d failed (hook: %s)\n' "$pass" "$fail" "$hook"
(( fail == 0 ))
