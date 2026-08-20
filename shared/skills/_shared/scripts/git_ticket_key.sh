#!/usr/bin/env bash
# git_ticket_key.sh — print the ticket key embedded in the current branch name.
# Output: key on stdout (e.g. "EC-80850", "#42"), or empty string if none. Exit 0 always.
set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || {
  echo "error: not inside a git repository" >&2; exit 1
}

if [[ "$branch" =~ ([A-Z]+-[0-9]+) ]]; then
  echo "${BASH_REMATCH[1]}"; exit 0
fi

if [[ "$branch" =~ issue[-/]([0-9]+) ]]; then
  echo "#${BASH_REMATCH[1]}"; exit 0
fi

exit 0
