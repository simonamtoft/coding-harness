# coding-harness

Canonical, version-controlled setup for my coding agents. The repository keeps
user-authored resources together while leaving credentials, sessions, caches,
installed packages, and other runtime state in their native harness
directories.

## Install links

```sh
~/coding-harness/link.sh --force
```

Without `--force`, the script refuses to replace any existing path. Forced
replacements are moved to `~/.coding-harness-backups/<timestamp>` first.

Run the script again after cloning or pulling this repository. It is safe to
run repeatedly; already-correct links are left untouched.

## Pi packages

`pi/agent/packages.txt` records the Pi packages this setup expects:

| Package | Source |
| --- | --- |
| [pi-worktree-agents](https://github.com/simonamtoft/pi-worktree-agents) | `git:github.com/simonamtoft/pi-worktree-agents` |
| [pi-status-footer](https://github.com/simonamtoft/pi-status-footer) | `git:github.com/simonamtoft/pi-status-footer` |

Install them with:

```sh
~/coding-harness/link.sh --packages
```

This runs `pi install` per entry, which writes the `packages` array in the
local `~/.pi/agent/settings.json`. Entries already installed are skipped.

When developing one of the plugins, point its settings entry at the local
checkout instead (for example `../../projects/pi-worktree-agents`, relative to
`~/.pi/agent`). The install step recognises a checkout by directory name and
leaves the override in place.

## Layout

- `shared/`: the common `AGENTS.md`, skills, and command-safety regression contract consumed by both harnesses.
- `pi/agent/`: Pi instructions, extensions, agents, prompts, and the
  `packages.txt` manifest. Provider/model configuration is local-only and
  intentionally ignored by Git.

The Pi sandbox extension is enabled automatically from `pi/agent/extensions/`.
It hard-denies the high-risk Bash commands in `shared/command-safety.tsv` (such
as Git force-push, destructive Git rewrites, `sudo`, pipe-to-shell execution,
and unsafe deletion), then limits model filesystem tools to the session's current directory, while also
providing a private mode-0700 workspace under the process temp directory for
scratch artifacts. Sessions started in this harness or `~/pi-plugins` may also
edit the user-owned plugin checkouts under `~/pi-plugins`. Delivered reports and
handoffs in retained private session
workspaces stay readable, while other retained scratch content prompts and
writes remain scoped to the current session. Reads elsewhere prompt, apart from
direct reads in the canonical shared tree (including installed Pi skills that
resolve there) and read-tool access to installed Volta package content.
Recursive tools do not receive the shared-tree exception. The sandbox follows
symlinks before checking and hard-denies common secret paths
everywhere. Agent control files and plugin source are write-protected unless Pi
was started inside this canonical `coding-harness` checkout. Session transcripts
and local Pi configuration are normalized to owner-only permissions at startup.
Its Bash protections are lexical checks, so they catch explicit paths and known
high-risk commands but do not constitute an OS-enforced sandbox; use a container
or VM when that boundary is required.
- `claude/`: Claude hooks, settings, agents, statusline, and themes.

Only genuinely harness-neutral resources live in `shared/`, and they are the
single source of truth for both harnesses:

```text
~/coding-harness/shared/AGENTS.md -> ~/.pi/agent/AGENTS.md + ~/.claude/CLAUDE.md
~/coding-harness/shared/skills    -> ~/.pi/agent/skills   + ~/.claude/skills
~/coding-harness/shared/command-safety.tsv -> shared command-deny regression contract
```

Everything else is harness-specific, because the two harnesses disagree on
format or capability:

| Resource | Why it is not shared |
| --- | --- |
| `pi/agent/prompts/` | Pi reads `prompts/`; Claude Code reads `commands/`. `review.md` also calls `review_changes`, a Pi extension tool. |
| `pi/agent/agents/` | Agent frontmatter differs per harness (`model` and `tools` vocabularies). The reviewers are Pi-only because `review_changes` drives them. |
| `claude/agents/` | A Claude-shaped `presenter` so the shared `present` skill works in both harnesses. |

The `present` skill stays shared: its report pipeline (`PRESENTER.md`,
`scripts/`, `assets/`) is harness-neutral, and only the delegation call differs
(Pi's `subagent` tool vs Claude Code's `Task` tool). Both are documented in the
skill.

Per-project verifiers are harness-neutral too. Pi's `verify-turn` extension and
Claude's `verify-turn.sh` Stop hook both resolve `.agent/verify.sh`, then a
`verify` task in a `Taskfile`, so a repo wires one verifier for both. Pi discovers
and executes these repository-controlled commands only after Pi project trust
and a separate content-bound verifier approval for the current session.

Pi's `~/.pi/agent/settings.json`, `~/.pi/agent/models.json`, and
`~/.pi/agent/subagents.json` remain local. The settings file contains package
paths relative to the native Pi directory, the model catalog points at
environment-specific providers, and `subagents.json` optionally maps agent
names to machine-specific `provider/model` values. Authentication and generated
state are also intentionally not versioned.

## Session context hygiene

Prefer one focused task per session. In Pi, use `/ctx-monitor` to inspect which
sources are consuming the context window. When a session grows large, use
`/handoff` to preserve its decisions and state, then continue in a fresh
session. Reloading `AGENTS.md` can restore attention to instructions
temporarily, but it does not remove the accumulated context.

## Resources

- https://github.com/cursor/plugins/tree/main/pstack/skills/
- https://github.com/mattpocock/skills/tree/main/skills
- https://fabiensanglard.net/agent.md/index.html
- https://github.com/amosblomqvist/pi-config/tree/main
