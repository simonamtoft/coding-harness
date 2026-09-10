#!/usr/bin/env bash
# Capture the working-tree evidence that commit-planner is allowed to inspect.
set -euo pipefail

workspace=${1:?usage: capture_snapshot.sh <session-workspace> [user-scope]}
user_scope=${2:-}
skill_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
snapshot_dir=$(mktemp -d "$workspace/quick-commit.XXXXXX")
evidence="$snapshot_dir/evidence"

cleanup_on_error() {
  local status=$?
  rm -rf -- "$snapshot_dir"
  exit "$status"
}
path_size() {
  stat -f %z -- "$1" 2>/dev/null || stat -c %s -- "$1"
}

trap cleanup_on_error ERR
chmod 700 "$snapshot_dir"

status_file="$snapshot_dir/status"
git status --short >"$status_file"
chmod 600 "$status_file"
if [[ ! -s "$status_file" ]]; then
  rm -rf -- "$snapshot_dir"
  trap - ERR
  printf 'EMPTY\n'
  exit 0
fi

: >"$evidence"
chmod 600 "$evidence"
{
  printf 'USER-STATED SCOPE:\n%s\n\n' "$user_scope"
  printf 'GIT STATUS:\n'
  cat "$status_file"
  printf '\nUNSTAGED DIFF:\n'
  git diff
  printf '\nSTAGED DIFF:\n'
  git diff --staged
  printf '\nCOMMIT MESSAGE RULES:\n'
  cat "$skill_dir/../_shared/commit-message-rules.md"
  printf '\nDETECTED COMMIT STYLE:\n'
  "$skill_dir/../generate-commit-message/scripts/detect_commit_style.sh"
  printf '\nBRANCH TICKET KEY:\n'
  "$skill_dir/../_shared/scripts/git_ticket_key.sh"
  printf '\nRECENT COMMIT SUBJECTS:\n'
  git log -10 --format=%s
  printf '\nUNTRACKED PATHS:\n'
} >>"$evidence"

while IFS= read -r -d '' path; do
  if size=$(path_size "$path"); then :; else size=unknown; fi
  if [[ ! -f "$path" || -L "$path" || ! -r "$path" ]]; then
    printf 'UNCAPTURED: nonregular or unreadable path %q (%s bytes)\n' "$path" "$size" >>"$evidence"
    continue
  fi
  if ! LC_ALL=C grep -Iq '' "$path"; then
    printf 'UNCAPTURED: binary path %q (%s bytes)\n' "$path" "$size" >>"$evidence"
    continue
  fi

  printf '\nUNTRACKED FILE: %q (%s bytes)\n' "$path" "$size" >>"$evidence"
  git diff --no-index -- /dev/null "$path" >>"$evidence" || {
    status=$?
    if [[ $status -gt 1 ]]; then
      exit "$status"
    fi
  }
done < <(git ls-files --others --exclude-standard -z)

trap - ERR
printf '%s\n' "$evidence"
