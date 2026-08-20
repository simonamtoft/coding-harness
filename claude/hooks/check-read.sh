#!/usr/bin/env bash
# PreToolUse hook for Read. Blocks reads of protected secret files.
#
# Reinstates the secret-file protection that the host-managed policy
# (`allowManagedPermissionRulesOnly: true`) silently disabled by ignoring
# user-level permissions.deny. See lib-secret-paths.sh for the path list and
# rationale. Default-allow for everything else.

set -uo pipefail

if [[ "${CLAUDE_HOOK_DISABLE:-}" == "1" ]]; then
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

source "$(dirname "${BASH_SOURCE[0]}")/lib-secret-paths.sh"

file_path=$(jq -r '.tool_input.file_path // empty')
[[ -z "$file_path" ]] && exit 0

if path_is_secret "$file_path"; then
  cat >&2 <<EOF
Hook: read of '${file_path}' blocked — protected secret path.

Reading keys / cloud credentials / keychains is off-limits. If you genuinely
need a value from here, ask the user to provide it.

To bypass for a single session, start it with CLAUDE_HOOK_DISABLE=1.
EOF
  exit 2
fi

exit 0
