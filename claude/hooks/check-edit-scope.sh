#!/usr/bin/env bash
# PreToolUse hook for Edit / Write / MultiEdit / NotebookEdit.
# Blocks file writes outside the per-repo .claude/scope.allow allowlist.
# Default-allow when no scope.allow is present, so unrelated repos are not affected.

set -uo pipefail

if [[ "${CLAUDE_HOOK_DISABLE:-}" == "1" ]]; then
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Hook: jq not installed (brew install jq). Blocking edits for safety." >&2
  exit 2
fi

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')

if [[ -z "$file_path" ]]; then
  exit 0
fi

case "$file_path" in
  /*) abs="$file_path" ;;
  *)  abs="${PWD}/${file_path}" ;;
esac

# Always block writes under ~/Desktop (repeated anti-pattern from the Cursor audit).
if [[ "$abs" == "$HOME/Desktop"/* || "$abs" == "$HOME/Desktop" ]]; then
  echo "Hook: edits to ~/Desktop are blocked. Pick a path inside a project repo." >&2
  exit 2
fi

project_dir="${CLAUDE_PROJECT_DIR:-}"

# No project dir or no allowlist -> default-allow.
if [[ -z "$project_dir" || ! -f "${project_dir}/.claude/scope.allow" ]]; then
  exit 0
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line=$(echo "$line" | xargs)
  [[ -z "$line" ]] && continue
  case "$line" in
    /*) allowed="$line" ;;
    *)  allowed="${project_dir}/${line}" ;;
  esac
  allowed="${allowed%/}"
  allowed="${allowed%/.}"
  [[ -z "$allowed" ]] && allowed="$project_dir"
  if [[ "$abs" == "$allowed" || "$abs" == "$allowed"/* ]]; then
    exit 0
  fi
done < "${project_dir}/.claude/scope.allow"

cat >&2 <<EOF
Hook: edit to '${abs}' blocked — outside scope declared in:
  ${project_dir}/.claude/scope.allow

Either ask the user to widen scope (add the path as a new line to scope.allow), or propose the change as text in your reply instead of writing it.

To bypass for a single session, start it with CLAUDE_HOOK_DISABLE=1 in the environment.
EOF
exit 2
