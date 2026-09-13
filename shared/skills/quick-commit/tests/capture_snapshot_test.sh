#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
capture="$script_dir/../scripts/capture_snapshot.sh"
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local file=$1 expected=$2
  grep -F -- "$expected" "$file" >/dev/null || fail "expected $expected in $file"
}

new_repo() {
  local name=$1
  local repo="$tmp/$name"
  git init -q "$repo"
  git -C "$repo" config user.name Test
  git -C "$repo" config user.email test@example.com
  printf 'baseline\n' >"$repo/tracked.txt"
  git -C "$repo" add tracked.txt
  git -C "$repo" commit -qm baseline
  printf '%s\n' "$repo"
}

clean_repo=$(new_repo clean)
clean_workspace="$tmp/clean-workspace"
mkdir "$clean_workspace"
clean_output=$(cd "$clean_repo" && "$capture" "$clean_workspace" 'clean test')
[[ $clean_output == EMPTY ]] || fail "clean repository returned $clean_output"
[[ -z $(find "$clean_workspace" -mindepth 1 -print -quit) ]] || fail 'clean snapshot was not removed'

unstaged_repo=$(new_repo unstaged)
unstaged_workspace="$tmp/unstaged-workspace"
mkdir "$unstaged_workspace"
printf 'unstaged only\n' >>"$unstaged_repo/tracked.txt"
unstaged_evidence=$(cd "$unstaged_repo" && "$capture" "$unstaged_workspace" 'unstaged test')
[[ -f $unstaged_evidence ]] || fail 'unstaged-only capture did not return an evidence file'
assert_contains "$unstaged_evidence" '+unstaged only'
rm -rf -- "$(dirname -- "$unstaged_evidence")"

repo=$(new_repo changes)
workspace="$tmp/changes-workspace"
mkdir "$workspace"
printf 'unstaged\n' >>"$repo/tracked.txt"
printf 'staged\n' >"$repo/staged.txt"
git -C "$repo" add staged.txt
mkdir -p "$repo/nested"
printf 'nested\n' >"$repo/nested/new file.txt"
printf 'space\n' >"$repo/with space.txt"
printf '\0binary' >"$repo/asset.bin"
printf 'STAGED_SECRET\n' >"$repo/.env"
git -C "$repo" add .env
printf 'UNTRACKED_SECRET\n' >"$repo/private.key"
ln -s tracked.txt "$repo/tracked-link"
evidence=$(cd "$repo" && "$capture" "$workspace" 'commit the current change')
[[ -f $evidence ]] || fail 'capture did not return an evidence file'
assert_contains "$evidence" 'USER-STATED SCOPE:'
assert_contains "$evidence" 'commit the current change'
assert_contains "$evidence" 'GIT STATUS:'
assert_contains "$evidence" 'UNSTAGED DIFF:'
assert_contains "$evidence" 'STAGED DIFF:'
assert_contains "$evidence" 'COMMIT MESSAGE RULES:'
assert_contains "$evidence" 'DETECTED COMMIT STYLE:'
assert_contains "$evidence" 'RECENT COMMIT SUBJECTS:'
assert_contains "$evidence" '+unstaged'
assert_contains "$evidence" '+staged'
assert_contains "$evidence" 'nested/new file.txt'
assert_contains "$evidence" '+nested'
assert_contains "$evidence" 'with space.txt'
assert_contains "$evidence" 'UNCAPTURED: binary path asset.bin'
assert_contains "$evidence" 'UNCAPTURED: protected secret path .env'
assert_contains "$evidence" 'UNCAPTURED: protected secret path private.key'
assert_contains "$evidence" 'UNCAPTURED: nonregular or unreadable path tracked-link'
if grep -F -e STAGED_SECRET -e UNTRACKED_SECRET "$evidence" >/dev/null; then
  fail 'evidence captured protected secret contents'
fi
assert_contains "$evidence" 'UNTRACKED FILE: nested'

rm -rf -- "$(dirname -- "$evidence")"
printf 'capture_snapshot_test: ok\n'
