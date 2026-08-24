# Pi sandbox guard

This extension is loaded from the global Pi extensions directory and applies a
host-side boundary to model tool calls:

- `read`, `grep`, `find`, and `ls` may access the current working directory and
  descendants without prompting.
- Reads outside that directory prompt with `Allow once`, `Allow for this
  session`, or `Deny`. Non-interactive sessions deny them.
- Read tools are pre-approved for `SKILL.md` files in the canonical
  `coding-harness` checkout and for installed package content under Volta's
  `tools/image/packages` directory.
- `write` and `edit` are always blocked outside the session directory,
  resolving existing symlinks and existing parent directories before checking.
- `.env*`, SSH/cloud credentials, private-key names, credential JSON names,
  keychains, `*.pem`, and `*.key` are hard-denied everywhere, including inside
  the project.
- Bash is blocked when it contains an explicit path outside the current
  directory or one of the protected secret patterns; it does not use the read
  approval prompt.
- Subagents inherit this guard, and their requested working directories must
  remain inside the parent session directory.

This is a tool-call guard, not an OS sandbox. Bash commands using variables,
redirections, command substitution, or programs that discover paths at runtime
can bypass a lexical command check. Use a container, VM, or OS sandbox when a
strong filesystem boundary is required. User-entered `!` commands and
extensions also remain outside this guard.

The session boundary is deliberately fixed to the Pi process's startup cwd.
The two trusted read locations above are derived from the extension checkout
and `VOLTA_HOME` (falling back to `~/.volta`); there is no configurable bypass.
