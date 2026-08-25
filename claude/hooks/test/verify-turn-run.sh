#!/usr/bin/env bash
# Regression checks for content-targeted verify-turn behavior.

set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
hook="$here/../verify-turn.sh"
root=$(mktemp -d "${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}/verify-turn-test.XXXXXX")
project="$root/project"
state="$root/state"
trap 'rm -rf "$root"' EXIT

mkdir -p "$project/.agent" "$state"
printf 'initial\n' > "$project/example.txt"
git -C "$project" init -q
git -C "$project" config user.email test@example.com
git -C "$project" config user.name Test
git -C "$project" add example.txt
git -C "$project" commit -qm initial

cat > "$project/.agent/verify.sh" <<'SH'
#!/usr/bin/env bash
count=0
[[ -f "$VERIFY_COUNT" ]] && count=$(cat "$VERIFY_COUNT")
printf '%s\n' "$((count + 1))" > "$VERIFY_COUNT"
[[ "${VERIFY_FAIL:-0}" != "1" ]]
SH
chmod +x "$project/.agent/verify.sh"

payload='{"session_id":"verify-turn-regression"}'
export CLAUDE_PROJECT_DIR="$project"
export TMPDIR="$state"
export VERIFY_COUNT="$state/count"

invoke() {
  local mode=${1:-}
  CLAUDE_HOOK_DISABLE= bash "$hook" $mode <<<"$payload" >/dev/null 2>&1
}

assert_count() {
  local expected=$1
  local actual=0
  [[ -f "$VERIFY_COUNT" ]] && actual=$(cat "$VERIFY_COUNT")
  if [[ "$actual" != "$expected" ]]; then
    printf 'expected verifier count %s, got %s\n' "$expected" "$actual" >&2
    exit 1
  fi
}

invoke snapshot
invoke
assert_count 0

git -C "$project" add example.txt
git -C "$project" commit --allow-empty -qm metadata-only
invoke
assert_count 0

invoke snapshot
mkdir -p "$project/docs"
printf 'new docs\n' > "$project/docs/guide.md"
invoke
assert_count 0

invoke snapshot
printf 'updated docs\n' > "$project/docs/guide.md"
invoke
assert_count 0

invoke snapshot
rm "$project/docs/guide.md"
invoke
assert_count 0

invoke snapshot
printf 'changed\n' > "$project/example.txt"
invoke
assert_count 1

invoke snapshot
printf 'changed and committed\n' > "$project/example.txt"
git -C "$project" add example.txt
git -C "$project" commit -qm changed-and-committed
invoke
assert_count 2

invoke snapshot
printf 'untracked\n' > "$project/new-file.txt"
invoke
assert_count 3

invoke snapshot
printf 'mixed docs\n' > "$project/README.md"
printf 'mixed code\n' > "$project/example.txt"
invoke
assert_count 4

invoke snapshot
printf 'changed again\n' > "$project/example.txt"
VERIFY_FAIL=1 invoke
[[ $? -eq 2 ]] || { echo "expected first failed verification to block" >&2; exit 1; }
assert_count 5

printf 'repair notes\n' >> "$project/README.md"
VERIFY_FAIL=1 invoke
[[ $? -eq 2 ]] || { echo "expected Markdown-only repair round to rerun" >&2; exit 1; }
assert_count 6

printf 'verify-turn regression checks passed\n'
