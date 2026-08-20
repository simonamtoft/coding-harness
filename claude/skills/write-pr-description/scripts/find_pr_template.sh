#!/usr/bin/env bash
# find_pr_template.sh — locate the repo's PR template file.
# Usage: find_pr_template.sh [repo-root]  (defaults to git root)
# Output: absolute path, or "NONE". Exit 0 always.
set -euo pipefail

root="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[[ -z "$root" ]] && { echo "error: not a git repo" >&2; exit 1; }

candidates=(
  "$root/.github/PULL_REQUEST_TEMPLATE.md"
  "$root/.github/pull_request_template.md"
  "$root/docs/pull_request_template.md"
  "$root/PULL_REQUEST_TEMPLATE.md"
)

for f in "${candidates[@]}"; do
  [[ -f "$f" ]] && { echo "$f"; exit 0; }
done

template_dir="$root/.github/PULL_REQUEST_TEMPLATE"
if [[ -d "$template_dir" ]]; then
  first="$(find "$template_dir" -maxdepth 1 -name '*.md' | sort | head -n1)"
  [[ -n "$first" ]] && { echo "$first"; exit 0; }
fi

echo "NONE"
