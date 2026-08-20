#!/usr/bin/env bash
# detect_commit_style.sh — classify the dominant commit-message convention.
# Output: conventional | ticket-prefixed | plain
set -euo pipefail

subjects="$(git log -10 --format=%s 2>/dev/null)" || subjects=""
[[ -z "$subjects" ]] && { echo "plain"; exit 0; }

conv_re='^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]+\))?!?:[[:space:]]'
conventional=0; ticket=0
while IFS= read -r line; do
  if [[ "$line" =~ $conv_re ]]; then
    ((conventional++)) || true
  elif [[ "$line" =~ ^[A-Z]+-[0-9]+[[:space:]] ]] || [[ "$line" =~ ^#[0-9]+[[:space:]] ]]; then
    ((ticket++)) || true
  fi
done <<< "$subjects"

if (( conventional > ticket && conventional >= 3 )); then echo "conventional"
elif (( ticket >= 3 )); then echo "ticket-prefixed"
else echo "plain"
fi
