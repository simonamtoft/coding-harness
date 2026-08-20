#!/usr/bin/env bash
# git_base_branch.sh — print the base branch name for current HEAD.
# Tries: open PR via gh → tracking branch upstream → common default names.
# Exit 1 if unresolvable (caller should ask the user).
set -euo pipefail

if command -v gh &>/dev/null; then
  base="$(gh pr view --json baseRefName --jq '.baseRefName' 2>/dev/null)" || base=""
  if [[ -n "$base" ]]; then echo "$base"; exit 0; fi
fi

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null)" || upstream=""
if [[ -n "$upstream" ]]; then echo "${upstream#*/}"; exit 0; fi

for candidate in main master develop; do
  if git show-ref --verify --quiet "refs/remotes/origin/${candidate}" 2>/dev/null; then
    echo "$candidate"; exit 0
  fi
done

echo "error: cannot determine base branch; ask the user to specify it" >&2
exit 1
