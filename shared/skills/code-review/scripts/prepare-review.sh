#!/usr/bin/env bash
set -euo pipefail

requested_base="${1:-AUTO}"

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Not inside a Git repository." >&2
  exit 1
fi

root=$(git rev-parse --show-toplevel)
cd "$root"

resolve_base() {
  if [[ "$requested_base" != "AUTO" ]]; then
    git rev-parse --verify "${requested_base}^{commit}"
    return
  fi

  local upstream origin_head candidate
  if origin_head=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); then
    git merge-base HEAD "$origin_head"
    return
  fi

  for candidate in origin/main origin/master main master; do
    if git rev-parse --verify --quiet "${candidate}^{commit}" >/dev/null; then
      git merge-base HEAD "$candidate"
      return
    fi
  done

  if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null); then
    git merge-base HEAD "$upstream"
    return
  fi

  if git rev-parse --verify --quiet HEAD^ >/dev/null; then
    git rev-parse HEAD^
    return
  fi

  git mktree </dev/null
}

base=$(resolve_base) || {
  echo "Could not resolve review base: $requested_base" >&2
  exit 1
}

bundle_dir="${2:-${TMPDIR:-/tmp}}"
bundle=$(mktemp "$bundle_dir/pi-review-XXXXXX")
chmod 600 "$bundle"

review_pathspec=(.)
if [[ "$bundle" == "$root/"* ]]; then
  bundle_relative=${bundle#"$root/"}
  review_pathspec+=(":(exclude)$bundle_relative")
fi

{
  printf '# Review bundle\n\n'
  printf -- '- Repository: `%s`\n' "$root"
  printf -- '- Base commit: `%s`\n' "$base"
  printf -- '- Head commit: `%s`\n\n' "$(git rev-parse HEAD 2>/dev/null || printf 'unborn')"
  printf '## Working tree status\n\n```text\n'
  git status --short -- "${review_pathspec[@]}"
  printf '```\n\n## Patch from base to working tree\n\n```diff\n'
  git diff --no-ext-diff --find-renames "$base" -- "${review_pathspec[@]}"
  printf '```\n'

  while IFS= read -r -d '' file; do
    printf '\n## Untracked file: `%s`\n\n```diff\n' "$file"
    git diff --no-ext-diff --no-index -- /dev/null "$file" || status=$?
    if [[ "${status:-0}" -gt 1 ]]; then
      echo "Could not capture untracked file: $file" >&2
      exit "$status"
    fi
    status=0
    printf '```\n'
  done < <(git ls-files --others --exclude-standard -z -- "${review_pathspec[@]}")
} > "$bundle"

if [[ -z "$(git status --short -- "${review_pathspec[@]}")" && -z "$(git diff --name-only "$base" -- "${review_pathspec[@]}")" ]]; then
  rm -f "$bundle"
  echo "No changes found relative to $base." >&2
  exit 2
fi

printf '%s\n' "$bundle"
