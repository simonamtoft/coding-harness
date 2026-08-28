#!/usr/bin/env bash
# PreToolUse hook for Bash. Denylist model:
#
#   1. hard-deny a small, stable set of irreversible / outward-facing actions
#   2. auto-allow a readonly set, to save prompts
#   3. defer everything else to the normal permission flow (a prompt)
#
# The rail that actually bounds execution is the OS sandbox (sandbox.* in
# settings.json), not this hook — see ~/.claude/hooks/README.md. This file only
# covers what the sandbox cannot judge: intent that is destructive *within* the
# sandbox boundary (force-push, history rewrite, secret exfil).
#
# Unrecognized is NOT dangerous: it defers. See README.md for policy and bypass.

set -uo pipefail

if [[ "${CLAUDE_HOOK_DISABLE:-}" == "1" ]]; then
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Hook: jq not installed (brew install jq). Blocking Bash for safety." >&2
  exit 2
fi

source "$(dirname "${BASH_SOURCE[0]}")/lib-secret-paths.sh"

cmd=$(jq -r '.tool_input.command // empty')
[[ -z "$cmd" ]] && exit 0

_emit_allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"readonly allowlist"}}\n'
  exit 0
}

# Defer: no envelope, exit 0 -> Claude's normal permission flow (a prompt).
_defer() { exit 0; }

_trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  printf '%s' "${s%"${s##*[![:space:]]}"}"
}

_normalize_path() {
  local path="$1" result="" part
  local -a parts
  IFS='/' read -ra parts <<< "$path"
  for part in "${parts[@]}"; do
    case "$part" in
      ""|".") ;;
      "..") result="${result%/*}" ;;
      *) result="$result/$part" ;;
    esac
  done
  printf '%s' "${result:-/}"
}

_resolve() {
  local p="$1"
  if   [[ "$p" == /* ]];   then printf '%s' "$(_normalize_path "$p")"
  elif [[ "$p" == "~"* ]]; then printf '%s' "$(_normalize_path "${p/#\~/$HOME}")"
  else                          printf '%s' "$(_normalize_path "$PWD/$p")"
  fi
}

# ---------------------------------------------------------------------------
# Quote masking. Two levels, because the two scans need different things:
#
#   single-quote masking — nothing inside '…' can ever execute, so masking it is
#     always sound. Used by the DENY scan, which must still see into "…" because
#     `$(…)` DOES execute inside double quotes: `echo "$(sudo rm -rf /)"`.
#
#   full masking — both quote styles. Used by the ALLOW scan, so that
#     `grep -E '(a|b)'` is not mis-split on the `|` inside the quotes.
#
# The asymmetry is the point: a denylist may over-match, an allowlist may not.
#
# Both use the `$!{N;ba}` slurp form, NOT `:a;N;$!ba`: on BSD/macOS sed the
# latter runs N on the final line, hits EOF and quits WITHOUT printing, so
# single-line input yields empty output — silently disabling the scan.
# ---------------------------------------------------------------------------
_mask_single_quotes() {
  printf '%s' "$1" | sed -E -e ':a' -e '$!{N;ba' -e '}' \
    -e "s/'[^']*'/__QSTR__/g"
}

_mask_quotes() {
  printf '%s' "$1" | sed -E -e ':a' -e '$!{N;ba' -e '}' \
    -e "s/'[^']*'/__QSTR__/g" -e 's/"[^"]*"/__QSTR__/g'
}

# Split into one segment per command. Breaks on the shell separators, on
# substitution/group openers, and on `-exec` — so a command smuggled into
# `find … -exec rm -rf /etc {}` surfaces as its own segment and is scanned like
# any other. That is also why _is_readonly_segment needs no -exec special case.
_split() {
  printf '%s' "$1" | sed -E \
    -e 's/&&|\|\|/\n/g' \
    -e 's/[|;]/\n/g' \
    -e 's/\$\(|<\(|>\(|`/\n/g' \
    -e 's/\)/\n/g' \
    -e 's/-(exec|execdir|ok|okdir)[[:space:]]+/\n/g'
}

# Strip shell noise that does not change which command runs: control keywords,
# group wrappers, VAR=val prefixes, and harmless redirections. Used by BOTH
# scans, so `do rm -rf /etc` is recognized as an `rm` by the deny scan too.
_strip_noise() {
  local s
  s=$(_trim "$1")

  local prev=""
  while [[ "$s" != "$prev" ]]; do
    prev="$s"
    s="${s#[\(\{]}"
    s=$(_trim "$s")
    case "$s" in
      do|do\ *)       s=$(_trim "${s#do}") ;;
      then|then\ *)   s=$(_trim "${s#then}") ;;
      else|else\ *)   s=$(_trim "${s#else}") ;;
      elif|elif\ *)   s=$(_trim "${s#elif}") ;;
      if|if\ *)       s=$(_trim "${s#if}") ;;
      # `while`/`until` headers wrap a real command: peel the keyword and judge
      # the condition on its own (`while read -r l` -> `read -r l`).
      while|while\ *) s=$(_trim "${s#while}") ;;
      until|until\ *) s=$(_trim "${s#until}") ;;
      \!|\!\ *)       s=$(_trim "${s#\!}") ;;
    esac
    while [[ "$s" =~ ^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+ ]]; do
      s=$(_trim "${s#*[[:space:]]}")
    done
  done

  while [[ "$s" == *[\)\}] ]]; do s=$(_trim "${s%[\)\}]}"); done

  # Harmless redirections: fd merges, /dev/null sinks, stdin reads, and the
  # `{}` placeholder left behind by a split -exec clause.
  s=$(printf '%s' "$s" | sed -E \
    -e 's/[0-9]?>&[0-9]//g' \
    -e 's/[0-9]?>>?[[:space:]]*\/dev\/null//g' \
    -e 's/<[[:space:]]*[^[:space:]]+//g' \
    -e 's/[[:space:]]\{\}[[:space:]]*\+?[[:space:]]*$//')

  # Reduce a path-qualified command to its basename: `/bin/rm` IS `rm`. Without
  # this, every tok1 comparison below (and in the deny scan) is trivially
  # evaded by spelling the absolute path.
  s=$(printf '%s' "$s" | sed -E 's|^/[^[:space:]]*/([^/[:space:]]+)|\1|')

  _trim "$s"
}

# True when a read would recurse from a root at or above $HOME. Such a command
# reaches ~/.ssh (and every other secret) without ever naming it, so the
# argument-based secret guard cannot see it. Not provably safe -> defer.
_is_wide_recursive_read() {
  local seg="$1" tok
  case "$seg" in
    # `rg`/`find` recurse by default — no -r needed.
    *" -r"*|*" -R"*|*" --recursive"*|find\ *|rg\ *|ripgrep\ *) ;;
    *) return 1 ;;
  esac
  local -a toks
  read -ra toks <<< "$seg"
  for tok in "${toks[@]:1}"; do
    [[ "$tok" == -* ]] && continue
    tok="${tok#[\"\']}"; tok="${tok%[\"\']}"
    [[ -z "$tok" || "$tok" == "{}" ]] && continue
    case "$(_resolve "$tok")" in
      "$HOME"|/) return 0 ;;
    esac
  done
  return 1
}

# Segments that execute nothing: bare control keywords (`done`, `fi`, `}`), a
# `for X in <words>` header (the list is data; the body arrives as its own
# segment), and a lone `VAR=value` assignment.
_is_keyword_only() {
  case "$1" in
    ""|done|fi|esac|else|then|do|\;\;) return 0 ;;
  esac
  [[ "$1" =~ ^for[[:space:]]+[A-Za-z_][A-Za-z0-9_]*([[:space:]]+in([[:space:]]|$)|[[:space:]]*$) ]] && return 0
  [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*$ ]] && return 0
  return 1
}

# ---------------------------------------------------------------------------
# rm scope, tri-state. "unknown" exists because an unexpanded variable cannot
# be resolved: `rm -rf "$HOME"` must not be allowed (it isn't provably in
# scope) but must not be hard-denied either (it isn't provably out). Unknown
# defers to a prompt, where the user can see what it actually is.
# ---------------------------------------------------------------------------
_rm_scope() {
  local seg tok1
  seg=$(_strip_noise "$1")
  read -r tok1 _ <<< "$seg"
  if [[ "$tok1" != "rm" && "$tok1" != "rmdir" ]]; then printf 'na'; return; fi

  local -a args
  read -ra args <<< "$seg"
  local arg resolved found=0 unresolvable=0
  for arg in "${args[@]:1}"; do
    [[ "$arg" == -* || "$arg" == "--" ]] && continue
    arg="${arg#[\"\']}"; arg="${arg%[\"\']}"
    [[ -z "$arg" || "$arg" == "{}" ]] && continue
    # Unprovable targets: an unexpanded variable could expand to `..` or `/`,
    # and a masked placeholder means the allow scan already replaced a quoted
    # string or substitution — in both cases the real path is unknown here.
    if [[ "$arg" == *'$'* || "$arg" == *__QSTR__* || "$arg" == *__SUBST__* ]]; then
      unresolvable=1; continue
    fi
    if [[ "$arg" == "~"* && "$arg" != "~" && "$arg" != "~/"* ]]; then
      printf 'out'; return
    fi
    found=1
    resolved=$(_resolve "$arg")
    if [[ "$resolved" != "$PWD" && "$resolved" != "$PWD/"* \
       && "$resolved" != "$HOME/.claude/plans/"* \
       && "$resolved" != /tmp/* && "$resolved" != /private/tmp/* ]]; then
      printf 'out'; return
    fi
  done
  if (( unresolvable )); then printf 'unknown'; return; fi
  if (( found )); then printf 'in'; return; fi
  printf 'unknown'
}

_touches_secret() {
  local seg tok
  seg=$(_strip_noise "$1")
  # macOS ships bash 3.2, where "${arr[@]}" on an empty array is fatal under
  # `set -u`. _strip_noise can legitimately return "" (a bare `}` segment).
  [[ -z "$seg" ]] && return 1
  local -a toks
  read -ra toks <<< "$seg"
  for tok in "${toks[@]}"; do
    [[ "$tok" == -* ]] && continue
    tok="${tok#[\"\']}"; tok="${tok%[\"\']}"
    [[ -z "$tok" ]] && continue
    path_is_secret "$tok" && return 0
  done
  return 1
}

# ===========================================================================
# 1. HARD DENY — the ratchet. Small, stable, and only for actions that are
#    irreversible or reach outside this machine. Scanned on the
#    single-quote-masked command, so `echo 'sudo …'` is not a false positive
#    but `echo "$(sudo …)"` still is a true one.
# ===========================================================================

_deny_reason=""

_hard_denied() {
  local scan="$1"

  # Any non-word character may precede it: whitespace, `/` (so `/usr/bin/sudo`
  # is caught), or `(` (so `$(sudo …)` is caught). `pseudo` is not matched
  # because it is preceded by an alphanumeric. Note `/` and `.` are NOT excluded
  # here — that was the gap that let a path-qualified sudo through.
  if [[ "$scan" =~ (^|[^[:alnum:]_-])sudo([[:space:]]|$) ]]; then
    _deny_reason="\`sudo\` — privilege escalation is never auto-run."; return 0
  fi

  # Any pipe into a shell can execute stdin, including `bash -s` with
  # positional arguments. Keep the rule conservative and deny the whole class.
  if [[ "$scan" =~ \|[[:space:]]*((sudo|/usr/bin/sudo|/bin/sudo)[[:space:]]+)?(/(usr/)?bin/)?(sh|bash|zsh)([[:space:]]|$) ]]; then
    _deny_reason="pipe-to-shell — executes piped code unreviewed."; return 0
  fi

  # A nested shell command string hides its payload inside an argument that the
  # normal quote masking deliberately removes. The outer Bash tool already
  # provides a shell, so require direct commands or an explicit script file.
  if [[ "$cmd" =~ (^|[^[:alnum:]_-])(/(usr/)?bin/)?(sh|bash|zsh)[[:space:]]+(-[[:alpha:]]*c[[:alpha:]]*|--command)([[:space:]]|$) ]]; then
    _deny_reason="nested shell command string — bypasses command safety inspection."; return 0
  fi

  # Force-push. --force-with-lease is deliberately NOT matched: it is the safe form.
  if [[ "$scan" =~ git([[:space:]]+[^[:space:]\;\|\&]+)*[[:space:]]+push([[:space:]]+[^[:space:]\;\|\&]+)*[[:space:]]+(-[[:alnum:]]*f[[:alnum:]]*|--force)([[:space:]]|$) ]] \
    || [[ "$scan" =~ git([[:space:]]+[^[:space:]\;\|\&]+)*[[:space:]]+push([[:space:]]+[^[:space:]\;\|\&]+)*[[:space:]]+\+[^[:space:]\;\|\&]+:[^[:space:]\;\|\&]+ ]]; then
    _deny_reason="\`git push --force\` — use --force-with-lease instead."; return 0
  fi

  # History rewrite / irrecoverable local destruction.
  if [[ "$scan" =~ git([[:space:]]+[^[:space:]\;\|\&]+)*[[:space:]]+reset([[:space:]]+[^[:space:]\;\|\&]+)*[[:space:]]+--hard ]]; then
    _deny_reason="\`git reset --hard\` — discards work irrecoverably."; return 0
  fi
  if [[ "$scan" =~ git([[:space:]]+[^[:space:]\;\|\&]+)*[[:space:]]+(filter-branch|filter-repo) ]]; then
    _deny_reason="git history rewrite."; return 0
  fi
  if [[ "$scan" =~ git([[:space:]]+[^[:space:]\;\|\&]+)*[[:space:]]+clean([[:space:]]+-[^[:space:]]*f) ]]; then
    _deny_reason="\`git clean -f\` — deletes untracked files irrecoverably."; return 0
  fi

  if [[ "$scan" =~ chmod([[:space:]]+-[^[:space:]]+)*[[:space:]]+(0)?777 ]]; then
    _deny_reason="\`chmod 777\` — world-writable."; return 0
  fi

  # Per-segment: secret paths and provably out-of-scope rm.
  # NOTE the `<<<` feed, not `< <(_split …)`: process substitution loses the
  # trailing newline, so `read` returns non-zero on the last (or only) segment
  # and the loop body never runs — which silently disables this entire scan.
  local seg segments
  segments=$(_split "$scan")
  while IFS= read -r seg; do
    seg=$(_trim "$seg")
    [[ -z "$seg" ]] && continue
    if _touches_secret "$seg"; then
      _deny_reason="touches a protected secret path (see lib-secret-paths.sh)."; return 0
    fi
    if [[ "$(_rm_scope "$seg")" == "out" ]]; then
      _deny_reason="\`rm\` outside \$PWD, /tmp, or ~/.claude/plans."; return 0
    fi
  done <<< "$segments"

  return 1
}

if _hard_denied "$(_mask_single_quotes "$cmd")"; then
  cat >&2 <<EOF
Hook: hard-denied — $_deny_reason

Command: ${cmd}

This is one of a small set of irreversible or outward-facing actions that are
never auto-run. If you genuinely need it, print it in a fenced \`\`\`bash block
and ask the user to run it themselves.
EOF
  exit 2
fi

# ===========================================================================
# 2. ALLOW — the readonly set, purely to save prompts. Conservative by
#    construction: anything not proven readonly falls through to defer.
# ===========================================================================

# `git` with global flags peeled off, so `git -C /repo status` reaches the
# `status` allowlist. This was the single largest false-positive class.
_git_subcommand() {
  local -a args
  read -ra args <<< "$1"
  [[ "${args[0]:-}" != "git" ]] && return 1
  local i=1 a
  while (( i < ${#args[@]} )); do
    a="${args[i]}"
    case "$a" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path)
        (( i += 2 )); continue ;;
      --git-dir=*|--work-tree=*|--namespace=*|--exec-path=*|--no-pager|--paginate|--bare|--literal-pathspecs|--no-replace-objects)
        (( i++ )); continue ;;
      -*)
        (( i++ )); continue ;;
      *)
        printf '%s' "${args[*]:i}"; return 0 ;;
    esac
  done
  return 1
}

_is_readonly_segment() {
  local seg
  seg=$(_strip_noise "$1")
  _is_keyword_only "$seg" && return 0

  # An unresolved output redirection means a write to an unknown path.
  [[ "$seg" == *">"* ]] && return 1

  # A recursive read rooted at $HOME or / reaches secrets without naming them.
  _is_wide_recursive_read "$seg" && return 1

  local tok1 tok2 _rest pair sub
  read -r tok1 tok2 _rest <<< "$seg"
  pair="${tok1} ${tok2}"

  # --- git, with global flags normalized away -----------------------------
  if sub=$(_git_subcommand "$seg"); then
    case "$sub" in
      # Branch mutation (-d/-D/-m/-M) must not ride in on the read form.
      branch\ *-[dDmM]*) return 1 ;;
      status|status\ *|diff|diff\ *|log|log\ *|show|show\ *|\
      branch|branch\ *|remote|remote\ *|stash|stash\ *|\
      rev-parse|rev-parse\ *|config|config\ *|ls-files|ls-files\ *|\
      ls-tree|ls-tree\ *|blame|blame\ *|describe|describe\ *|\
      shortlog|shortlog\ *|ls-remote|ls-remote\ *|\
      add|add\ *|commit|commit\ *) return 0 ;;
    esac
    return 1
  fi

  # --- gh: readonly subcommands + `gh api` without a write method ---------
  case "$seg" in
    "gh pr view"*|"gh pr diff"*|"gh pr list"*|"gh pr checks"*|\
    "gh run view"*|"gh run list"*|"gh run view-log"*|\
    "gh issue view"*|"gh issue list"*|"gh repo view"*) return 0 ;;
    "gh api"*)
      # Default method is GET; setting a method or a field makes it a write.
      [[ "$seg" =~ (-X|--method|[[:space:]]-f|[[:space:]]-F|--field|--input) ]] && return 1
      return 0 ;;
  esac

  # --- version/help probes ------------------------------------------------
  case "$pair" in
    *" --version"|*" --help"|*" -version"|"go version"|"node -v"|"npm -v") return 0 ;;
  esac

  # --- project toolchains: the verify loop (CLAUDE.md §4) -----------------
  case "$pair" in
    # Script runners: `run`/`test` only. `npm install` deliberately defers.
    "npm run"|"npm test"|"npm ci"|"npm ls"|"npm outdated"|\
    "pnpm run"|"pnpm test"|"pnpm ls"|\
    "yarn run"|"yarn test"|\
    "bun run"|"bun test"|\
    "uv run"|"uvx run"|\
    "cargo check"|"cargo test"|"cargo clippy"|"cargo fmt"|\
    "go build"|"go test"|"go vet"|\
    "terraform fmt"|"terraform validate"|"terraform plan"|"terraform show"|"terraform output"|\
    "docker ps"|"docker logs"|"docker images"|"docker inspect"|"docker info"|"docker version"|\
    "kubectl get"|"kubectl describe"|"kubectl logs") return 0 ;;
  esac

  # `task` is the project verifier entry point (see verify-turn.sh).
  [[ "$tok1" == "task" ]] && return 0

  # az: readonly verbs only.
  if [[ "$tok1" == "az" ]]; then
    [[ "$seg" =~ [[:space:]](list|show|version)([[:space:]]|$) ]] && return 0
    return 1
  fi

  # --- find: -delete is a write; -exec was already split into its own segment
  if [[ "$tok1" == "find" ]]; then
    [[ "$seg" == *" -delete"* ]] && return 1
    return 0
  fi

  # --- rm: only when provably in scope -----------------------------------
  if [[ "$tok1" == "rm" || "$tok1" == "rmdir" ]]; then
    [[ "$(_rm_scope "$seg")" == "in" ]] && return 0
    return 1
  fi

  # --- plain readonly utilities ------------------------------------------
  case "$tok1" in
    ls|pwd|cat|head|tail|wc|file|stat|grep|rg|ripgrep|which|type|echo|printf|\
    date|whoami|hostname|uname|id|tree|jq|yq|xmllint|column|sort|uniq|cut|awk|\
    sed|tr|paste|xxd|od|env|true|false|test|\[|mkdir|cd|basename|dirname|\
    realpath|readlink|diff|comm|join|nl|rev|fold|seq|sleep|read|shasum|md5|\
    cksum|du|df|ps|pdftotext|pdfinfo|pdffonts|fp)
      return 0 ;;
  esac

  return 1
}

# `$(readonly)` substitutions are peeled on the MASKED form, so a `$(` that
# only appears inside quotes is not mistaken for a live substitution.
_peel_subst() {
  local s="$1" start inner rest ch depth i=0
  while [[ "$s" == *'$('* ]] && (( i < 32 )); do
    (( i++ ))
    start="${s%%\$\(*}"
    rest="${s#"$start"\$\(}"
    depth=1; inner=""
    while [[ -n "$rest" && $depth -gt 0 ]]; do
      ch="${rest:0:1}"; rest="${rest:1}"
      if   [[ "$ch" == '(' ]]; then depth=$((depth+1)); inner+="$ch"
      elif [[ "$ch" == ')' ]]; then depth=$((depth-1)); [[ $depth -gt 0 ]] && inner+="$ch"
      else inner+="$ch"
      fi
    done
    (( depth != 0 )) && { printf '%s' "__BAD__"; return; }
    _is_readonly_segment "$inner" || { printf '%s' "__BAD__"; return; }
    s="${start}__SUBST__${rest}"
  done
  printf '%s' "$s"
}

masked=$(_mask_quotes "$cmd")

# Backticks and process substitution are not proven readonly -> defer, not deny.
[[ "$masked" == *'`'* || "$masked" == *'<('* || "$masked" == *'>('* ]] && _defer

if [[ "$masked" == *'$('* ]]; then
  masked=$(_peel_subst "$masked")
  [[ "$masked" == "__BAD__" ]] && _defer
fi

# `<<<` rather than `< <(…)` — see the note in _hard_denied.
segments=$(_split "$masked")
while IFS= read -r seg; do
  seg=$(_trim "$seg")
  [[ -z "$seg" ]] && continue
  _is_readonly_segment "$seg" || _defer
done <<< "$segments"

_emit_allow
