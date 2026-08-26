# Claude Code hooks

User-global hooks that enforce a small Bash denylist, a per-project edit scope, an end-of-turn verifier, and a secret-file read guard. The first two policies were surfaced by a prior environment audit (`~/projects/environment-audit/cursor_audit_out/summary.md`); the secret-file guard reinstates protection the host-managed policy silently disabled (see `check-read.sh`).

## The rail is the sandbox, not the hook

`sandbox.enabled: true` in `~/.claude/settings.json` runs every Bash call inside the macOS Seatbelt sandbox: writes are confined to the working directory plus the session temp dir, network is deny-by-default with per-host approval, and the credential files listed under `sandbox.credentials.files` are unreadable. That is an **OS-level** boundary — it holds across subprocesses, which an application-level string check structurally cannot.

This matters because the managed policy (`~/.claude/remote-settings.json`) sets `allowManagedPermissionRulesOnly: true`, making all user `permissions.allow`/`ask`/`deny` rules inert. `sandbox.*` is **not** covered by that policy, so it is the one real enforcement layer available to us. `credentials.files` is a direct port of `path_is_secret()` in `lib-secret-paths.sh`.

When a command fails *because* of the sandbox, Claude Code retries it with `dangerouslyDisableSandbox`, which goes through the normal permission prompt — a sandbox failure is never a dead end.

### `excludedCommands` — entries and why each exists

**Must be globs, not bare names.** `"gh"` matches only the bare word `gh` with no arguments, so a bare-name list is silently inert. Verified: with `"mkdir"` a write outside the sandbox stayed `EPERM`; with `"mkdir *"` it succeeded.

| Entry | Justification |
|---|---|
| `gh *`, `terraform *`, `gcloud *` | Go-based CLIs may fail TLS verification under Seatbelt (documented). **Not observed here** — carried on the docs' word, not a real failure. |
| `docker *` | Docs state plainly that docker is incompatible with the sandbox. |
| `git commit *` | Observed failure. SSH commit signing reads the private key, which `credentials.files` denies. Only `commit` is excluded — `git push`, `git checkout` and the rest stay sandboxed. |

Prefer `filesystem.allowWrite` over an exclusion when a tool merely needs to write somewhere: the docs call it "the recommended approach... rather than excluding the tool from the sandbox entirely". That is why `fp` gets an `allowWrite` entry for `~/Library/Application Support/fp` (its DB lives outside any project) rather than an exclusion. Paths with spaces work.

### `~/.ssh` and commit signing

`credentials.files` denies `~/.ssh`, with `filesystem.allowRead` re-opening exactly three files inside it: `id_ed25519.pub`, `allowed_signers`, `known_hosts`. A narrower allow does re-open part of a denied region — verified, and note this contradicts a plausible reading of the docs' precedence table, which also says "an exact deny holds inside a wider allow".

The private key stays denied, which is why `git commit *` is excluded. Signing is confirmed live, not assumed: `git log --format='%G?'` returns `G`.

**Do not "fix" this with `network.allowAllUnixSockets`.** Routing signing through ssh-agent instead does work, but it requires opening Unix sockets, and the docs warn that this "can inadvertently grant access to powerful system services that could lead to sandbox bypasses" — `/var/run/docker.sock` being the named example. That trades a key-read deny for a probable full sandbox escape. Sockets are left blocked (no `network` block at all).

If you ever do need a specific socket: the path must be **symlink-resolved** (`/private/var/run/…`, not `/var/run/…`, since `/var` is a symlink), and globs are **not** supported — both verified. The launchd agent socket also contains a per-boot random component, so pinning it breaks after a reboot.

### Two gaps, stated plainly

- A command the hook defers and you then approve runs *outside* the sandbox if it got there via the `dangerouslyDisableSandbox` retry. Approval is a real decision. `sandbox.allowUnsandboxedCommands: false` removes the escape hatch.
- **`sandbox.*` changes apply live, but with a propagation lag.** A single test run immediately after editing settings can read the *old* profile — observed once, giving a false pass. Re-run anything load-bearing before trusting it.

## Hooks

### `check-bash.sh` — Bash denylist

**Unrecognized is not dangerous.** The hook makes one of three decisions:

1. **hard-deny** (`exit 2`) — a small, stable set of irreversible or outward-facing actions;
2. **allow** (a `permissionDecision: "allow"` envelope) — a readonly set, purely to save prompts;
3. **defer** (`exit 0`, no envelope) — *everything else*, handed to the normal permission flow so you get a prompt you can approve.

This replaced a default-deny allowlist that blocked ~220–250 commands over four weeks (see `CLAUDE-decisions.md` for the measured baseline). An allowlist for a general-purpose tool can only ever lag: the space of legitimate commands is unbounded. A denylist enumerates a small, stable set instead.

**Hard-deny list.** `sudo`; pipe-to-shell (`… | sh`, but not `… | bash script.sh`); `git push --force`, force-bearing short options, or `+` refspecs (**not** `--force-with-lease`); `git reset --hard`; `git filter-branch`/`filter-repo`; `git clean -f`; `chmod 777`; `rm` provably outside `$PWD` / `/tmp` / `~/.claude/plans`; any segment touching a protected secret path.

**Allow list.** Readonly utilities; `git` read subcommands plus `add`/`commit`, **with global flags normalized away** so `git -C /repo status` and `git --no-pager diff` match; `gh` read subcommands and `gh api` without a write method; `--version`/`--help` probes; and the verify-loop toolchains — `npm|pnpm|yarn|bun run|test`, `uv run`, `task`, `terraform fmt|validate|plan`, `az … list|show`, `docker ps|logs|images|inspect`, `kubectl get|describe|logs`, `pdftotext`/`pdfinfo`. Blocking the verifier was the worst failure of the old design, since `CLAUDE.md` §4 mandates external verification.

Shell constructs are understood rather than rejected: `VAR=v cmd` prefixes, `( … )`, `{ …; }`, `for/while/until … do … done`, `sleep`, harmless redirections (`2>&1`, `>/dev/null`, `< file`), and `find … -exec` (the exec'd command is split out and judged on its own). An unresolved `>` redirection means an unknown write, so it defers.

**Deliberately *not* auto-allowed** (they defer to a prompt): `python3 -c '…'` and any other `python` invocation, `npx`/`bunx`, and scripts under `<project>/bin`. All three used to be auto-allowed, which meant the old hook waved through arbitrary code execution — including remote code, in the case of `npx` — while taxing `git -C … status`. Scripts under `.claude/skills` or `.claude/hooks` are still allowed.

**The two scans are deliberately asymmetric.** A denylist may over-match; an allowlist may not.
- The **deny** scan reads the command with only *single*-quoted strings masked, because `$(…)` executes inside double quotes — so `echo "$(sudo rm -rf /)"` is caught, while `echo 'sudo is a word'` is not.
- The **allow** scan reads the command with *both* quote styles masked, so `grep -E '(a|b)'` is not mis-split on the `|` inside the quotes, and no quoted content can ever talk it into allowing.
- Consequence to know about: an `rm` target that is quoted, a variable, or a substitution is not *provably* in scope, so it defers rather than being allowed or denied. `rm -rf "$HOME"` prompts.
- Known over-match: a dangerous pattern inside a **double**-quoted string is treated as real, so `rg "git push --force" notes.md` is hard-denied. Use single quotes.

**Two rules that exist because the guard was bypassed.** Both were found by testing the hook against its own threat model, and both are fixture cases now:

- **`tok1` is reduced to its basename**, because `/bin/rm` *is* `rm`. Every check compared the literal first token, so spelling the absolute path evaded the hard-deny entirely (`/bin/rm -rf /etc`, `/usr/bin/sudo ls`). The `sudo` pattern likewise must allow `/` and `(` to precede it — `$(sudo …)` and `/usr/bin/sudo` both need to match, while `pseudo` must not.
- **A recursive read rooted at `$HOME` or `/` never auto-allows.** `grep -r PRIVATE ~` reaches `~/.ssh` without ever naming it, so the argument-based secret guard cannot fire. It now defers to a prompt, where the command is visible. `rg` and `find` recurse without `-r`, so they are treated as recursive by default. Scoped reads (`grep -r TODO hooks/`, `rg -l TODO .`) still auto-allow.

The second is the clearest illustration of the layering: it is a mitigation, not a fix. Nothing in a command string reveals what `python3 script.py` will read. Only the sandbox can hold that line.

**Secret-path guard.** Independent of the above, any segment whose path-like tokens resolve to a protected secret (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.azure`, `~/.kube`, gcloud config, `~/Library/Keychains`, `~/.netrc`/`~/.npmrc`/`~/.pypirc`, `~/.docker/config.json`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `credentials.json`, `service-account*.json`) is hard-denied — covering writes and exfil (`git add ~/.ssh/id_rsa`) that the sandbox's read-deny does not. The list lives in `lib-secret-paths.sh`. See `check-read.sh` below for why this is enforced in hooks rather than `permissions.deny`.

**macOS bash 3.2.** The system `bash` is 3.2.57, where `"${arr[@]}"` on an empty array is fatal under `set -u`. Guard every array expansion that can be reached with an empty segment.

### `check-read.sh` — secret-file read guard

Blocks the `Read` tool from reading the same protected secret paths (shared matcher in `lib-secret-paths.sh`). Default-allow for everything else.

**Why this is a hook and not a `permissions.deny` rule:** the host-managed policy sets `allowManagedPermissionRulesOnly: true`, which makes *all* user-level `permissions.allow`/`deny` rules inert — only managed rules apply. The old `~/.ssh`/`~/.aws`/`*.pem` deny globs in `settings.json` therefore no longer block anything, and `cat`/`head` being on the readonly allowlist meant `cat ~/.ssh/id_rsa` was getting auto-*allowed*. User hooks still run under the managed policy (they aren't permission rules), so they're the only user-controlled enforcement layer left — hence the read guard plus the `check-bash.sh` secret guard above. Note: a user hook can *tighten* but never override a managed `deny`/`ask`.

### `check-edit-scope.sh` — per-project edit allowlist

Blocks `Edit` / `Write` / `MultiEdit` / `NotebookEdit` calls whose `file_path` falls outside the project's declared scope.

- Always blocks writes under `~/Desktop` (specific anti-pattern from the audit).
- Looks for `${CLAUDE_PROJECT_DIR}/.claude/scope.allow`. **If absent, default-allow** — unrelated repos are not affected.
- File format: one path-prefix per line. Relative paths resolve against the project root. Absolute paths are honored as-is. `#` comments and blank lines are ignored.

Example `scope.allow`:

```
# whole repo
.

# also let edits reach user-level Claude config (only for repos where this is intended)
/Users/example/.claude
```

### `verify-turn.sh` — end-of-turn verification feedback loop

A `UserPromptSubmit`/`Stop` hook pair that closes the loop with an *external* checker instead of letting the model self-assess correctness. The submit hook snapshots tracked and non-ignored untracked project content. When the turn completes, the Stop hook runs the project's verifier only if content outside Markdown files changed. Read-only, commit-only, and Markdown-only turns therefore skip redundant checks, while mixed Markdown/code changes and code edits committed in the same turn still trigger them. If the verifier fails, the hook relays the diagnostics on stderr and `exit 2`, so Claude sees the concrete errors and fixes them before finishing. (Motivated by arXiv 2511.00592 / CompPilot: feedback-grounded loops beat open-loop, and an external ground-truth checker beats LLM self-verification.)

It runs at the natural "I'm done" boundary — **not after every edit** — so intermediate multi-edit states aren't flagged. **Bounded retries** replace the old one-shot behavior: a per-session counter (`$TMPDIR/claude-verify-<session_id>`) allows up to `MAX_ROUNDS` (default 3) verify→fix rounds, so a *wrong* fix doesn't slip through after a single pass. Active repair rounds always rerun the verifier, even when content is unchanged or only Markdown changed. On the final round the message tells Claude to summarize the remaining failure for the user instead of looping; past the cap the hook stops trapping the turn (exits 0) so it can never spin forever. A passing verifier clears the counter. Cost note: a failing turn re-runs the verifier up to `MAX_ROUNDS`+1 times, so keep the verifier reasonably fast.

Verifier resolution is **optional and per-project**, in precedence order:

1. `${CLAUDE_PROJECT_DIR}/.agent/verify.sh` — run as `verify.sh` (from the project root).
2. else a `verify` task in `Taskfile.yml` / `Taskfile.yaml` at the project root (when the `task` CLI is installed and `task --list-all` shows a `verify` task) — run as `task verify`.

**If neither is present, the hook is a no-op** (default-noop, like `check-edit-scope.sh`'s default-allow), so unrelated repos are unaffected. Because it runs once per turn, a project-wide check (lint + typecheck) is fine here.

Both locations are harness-neutral on purpose: pi's `verify-turn` extension resolves the same two in the same order, so a project wires **one** verifier that serves both harnesses (the `wire-up-verifier` skill scaffolds it).

Example `.agent/verify.sh`:

```bash
#!/usr/bin/env bash
# non-zero exit = something to fix before finishing.
npx tsc --noEmit && npx eslint .
```

Example `Taskfile.yml` task:

```yaml
tasks:
  verify:
    cmds:
      - npx tsc --noEmit
      - npx eslint .
```

### `claude-md-refcheck.py` — CLAUDE.md package-map drift check

A second `Stop` hook (runs alongside `verify-turn.sh`) that catches *documentation* drift: `CLAUDE.md` files name files in backticks to describe a directory's layout (``routes/me.py``, ``VerdictBar.tsx``), and those maps rot when files are renamed or deleted. The hook scans every `CLAUDE.md` at/below the scan root (`CLAUDE_PROJECT_DIR`, else cwd; or an explicit path argument), extracts backticked filename tokens, and on any that no longer resolve to a real file relays them on stderr and `exit 2` — so Claude sees the concrete broken refs and can fix the doc before finishing.

**Deterministic half only.** It catches "named file doesn't exist" (the class that deleted-but-still-documented `VerdictBar.tsx` falls into). Stale *prose* ("step 6 in progress" after step 6 landed) is not mechanically checkable and is left to a per-project CI audit (e.g. sample-project's `.github/workflows/doc-drift.yml`, which runs the same idea through its model gateway).

**Conservative by construction** — false positives train you to ignore it:
- placeholder tokens (`step_N.py`, globs, `<...>` ranges) are skipped;
- a token resolves if it exists at the path OR its basename exists anywhere under the root, so a doc that names a file by basename never false-flags.

**Fires at most once per session** (a sentinel at `$TMPDIR/claude-md-refcheck-<session_id>`), so an unaddressed or intentional drift doesn't nag every turn. **No-op** when there's no `CLAUDE.md` under the root, so unrelated repos are unaffected. Honors `CLAUDE_HOOK_DISABLE=1`. Requires `python3` on `PATH` (invoked as `python3 …/claude-md-refcheck.py`, so the exec bit is irrelevant).

## Bypass

For an exceptional session where you genuinely want the agent to run commands or edit anywhere, start Claude Code with:

```bash
CLAUDE_HOOK_DISABLE=1 claude
```

All of these *user* hooks short-circuit when this env var is `1`. No in-conversation bypass exists by design — the whole point is to avoid the "I'll just run it" failure mode the audit caught repeatedly.

**Caveat under managed policy:** `CLAUDE_HOOK_DISABLE=1` only disables these user hooks. The host-managed PreToolUse hooks (e.g. the managed filesystem block) and managed `permissions.deny` rules are enforced by the client from the managed settings and are **not** affected — so this is not an "edit/run anything" escape hatch, only a way to drop the user-defined guardrails.

**It does not disable the sandbox either.** `CLAUDE_HOOK_DISABLE=1` drops the hooks, but `sandbox.enabled` still confines writes and network. That is the right split now: the hooks are convenience plus intent-checking, the sandbox is the actual boundary. To drop the boundary too you have to set `sandbox.enabled: false` — deliberately, and preferably not.

## Wiring

`~/.claude/settings.json` has a `hooks.PreToolUse` block matching `Bash` → `check-bash.sh`, `Read` → `check-read.sh`, and `Edit|Write|MultiEdit|NotebookEdit` → `check-edit-scope.sh`, and a `hooks.Stop` block with two hooks → `verify-turn.sh` then `python3 …/claude-md-refcheck.py`. Edit those blocks to disable temporarily; delete them to remove. (`check-read.sh` is invoked as `bash …/check-read.sh` so it doesn't depend on the execute bit; `claude-md-refcheck.py` is invoked as `python3 …` for the same reason.)

The same file carries the `sandbox` block described at the top. **`sandbox.*` edits apply mid-session**, without a restart — but with a propagation lag, so re-run a test before trusting a single result. Confirm the resolved config with `/sandbox` → Config tab.

## Dependencies

`jq` (Apple-shipped at `/usr/bin/jq` on recent macOS, or `brew install jq`). Both hooks block fail-closed if `jq` is missing.

## Testing

`check-bash.sh` has a regression fixture. Run it after any change:

```bash
bash ~/.claude/hooks/test/run.sh                    # against the installed hook
bash ~/.claude/hooks/test/run.sh /path/to/candidate # against a candidate, before installing
```

`test/cases.tsv` is `<expected>\t<command>`, where expected is `allow` / `defer` / `deny`. Most cases are verbatim commands harvested from `~/.claude/projects` transcripts where the old allowlist blocked real work; the block at the end is adversarial — cases written to break the design rather than confirm it (danger smuggled through double-quoted substitutions, through the shell-construct handling, and through `find -exec`).

Test a candidate **before** installing it: the hook gates your own Bash, so a broken one locks you out. Keep the candidate inside `hooks/` so `dirname $BASH_SOURCE` still finds `lib-secret-paths.sh` — otherwise `source` fails silently and the entire deny scan becomes inert while still reporting success.

Single payloads, by hand:

```bash
# allow -> exit 0 + an envelope on stdout
echo '{"tool_input":{"command":"git -C /repo status"}}' | ~/.claude/hooks/check-bash.sh; echo $?   # 0 + envelope
# defer -> exit 0, no envelope (a prompt)
echo '{"tool_input":{"command":"npm install foo"}}'     | ~/.claude/hooks/check-bash.sh; echo $?   # 0, no envelope
# deny -> exit 2
echo '{"tool_input":{"command":"ls ; rm -rf /etc"}}'    | ~/.claude/hooks/check-bash.sh; echo $?   # 2
CLAUDE_PROJECT_DIR=/some/repo echo '{"tool_input":{"file_path":"/tmp/x"}}' \
  | ~/.claude/hooks/check-edit-scope.sh; echo $?

# verify-turn.sh: no verifier in the project -> no-op (0)
CLAUDE_PROJECT_DIR=/tmp/none echo '{"stop_hook_active":false}' \
  | ~/.claude/hooks/verify-turn.sh; echo $?   # 0

# claude-md-refcheck.py: pass a scan root as arg (clean repo -> 0)
python3 ~/.claude/hooks/claude-md-refcheck.py /path/to/clean/repo </dev/null; echo $?   # 0
# a repo whose CLAUDE.md names a deleted file -> 2 + report on stderr
```
