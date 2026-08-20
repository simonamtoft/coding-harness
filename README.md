# coding-harness

Canonical, version-controlled setup for my coding agents. The repository keeps
user-authored Pi and Claude resources together while leaving credentials,
sessions, caches, installed packages, and other runtime state in their native
harness directories.

## Install links

```sh
~/coding-harness/link.sh --force
```

Without `--force`, the script refuses to replace any existing path. Forced
replacements are moved to `~/.coding-harness-backups/<timestamp>` first.

Run the script again after cloning or pulling this repository. It is safe to
run repeatedly; already-correct links are left untouched.

## Layout

- `pi/agent/`: Pi instructions, agents, extensions, prompts, and non-secret
  provider configuration.
- `claude/`: Claude instructions, hooks, skills, statusline, and themes.

Pi's `~/.pi/agent/settings.json` remains local because its package entries use
paths relative to the native Pi directory. Authentication and generated state
are also intentionally not versioned.
