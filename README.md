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

- `shared/`: the common `AGENTS.md`, skills, agents, and prompts linked into
  both harnesses.
- `pi/agent/`: Pi instructions, extensions, and the `packages.txt` manifest.
  Provider/model configuration is local-only and intentionally ignored by Git.
- `claude/`: Claude hooks, settings, statusline, and themes.

The shared resources are the single source of truth:

```text
~/coding-harness/shared/AGENTS.md -> ~/.pi/agent/AGENTS.md + ~/.claude/CLAUDE.md
~/coding-harness/shared/skills  -> ~/.pi/agent/skills  + ~/.claude/skills
~/coding-harness/shared/agents  -> ~/.pi/agent/agents  + ~/.claude/agents
~/coding-harness/shared/prompts -> ~/.pi/agent/prompts + ~/.claude/prompts
```

Claude discovers shared skills directly from `~/.claude/skills`. The shared
agents and prompts are kept outside either harness so they can be linked into
additional harnesses later without moving their canonical location.

Pi's `~/.pi/agent/settings.json` and `~/.pi/agent/models.json` remain local.
The settings file contains package paths relative to the native Pi directory,
and the model catalog points at environment-specific providers. Authentication
and generated state are also intentionally not versioned.
