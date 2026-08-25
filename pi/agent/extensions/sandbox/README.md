# Pi sandbox guard

This extension is loaded from the global Pi extensions directory and applies a
host-side boundary to model tool calls:

- `read`, `write`, `edit`, `grep`, `find`, and `ls` may access the current
  working directory and descendants without prompting.
- Reads outside that directory prompt with `Allow once`, `Allow for this
  session`, or `Deny`. Non-interactive sessions deny them.
- On POSIX systems, each session gets a private mode-0700 workspace at
  `${TMPDIR}/pi-agent-<uid>/<session-id>/`. All filesystem tools may read and
  write there, and Bash may use explicit absolute paths within it. The exact path
  is exposed as `PI_SESSION_TMPDIR` and added to the agent's system prompt. The
  extension fails closed when UID ownership cannot be verified. Read tools may
  also inspect delivered reports, captures, handoffs, and retrospectives in a
  retained UUID workspace that is still owned by the current user and private;
  other retained scratch content still prompts, and writes remain limited to the
  current session.
- Read tools are also pre-approved for `SKILL.md` files in the canonical
  `coding-harness` checkout and installed package content under Volta's
  `tools/image/packages` directory.
- Sessions started inside the canonical `coding-harness` checkout or
  `~/pi-plugins` may use all filesystem tools across `~/pi-plugins`. This is a
  scoped development exception for user-owned executable package source; it is
  unavailable to sessions started in other projects.
- `write` and `edit` are blocked everywhere else outside the session directory,
  resolving existing symlinks and existing parent directories before checking.
- `.env*`, SSH/cloud credentials, private-key names, credential JSON names,
  keychains, `*.pem`, and `*.key` are hard-denied everywhere, including inside
  the project.
- Bash is blocked when it contains an explicit path outside the current,
  permitted plugin workspace, or session temp directory; changes its working
  directory to the session temp directory; or names a protected secret pattern.
  Scratch commands must use absolute paths; Bash does not use the read approval
  prompt.
- Subagents inherit this guard, and their requested working directories must
  remain inside the parent project, the scoped plugin workspace, or the private
  session temp workspace.

This is a tool-call guard, not an OS sandbox. Bash commands using variables,
redirections, command substitution, or programs that discover paths at runtime
can bypass a lexical command check. Use a container, VM, or OS sandbox when a
strong filesystem boundary is required. User-entered `!` commands and
extensions also remain outside this guard.

The session boundary is deliberately fixed to the Pi process's startup cwd.
Trusted locations are derived from the extension checkout, `~/pi-plugins`,
`VOLTA_HOME` (falling back to `~/.volta`), the process temp directory, and Pi's
session UUID. Plugin-workspace access is enabled only when that startup cwd is
inside the extension checkout or plugin workspace.
The temp directory itself is not trusted: the current private session workspace
is fully available, while retained workspaces bypass read prompts only for the
delivered artifact names above. Only the current session workspace accepts
writes. Session workspaces are retained after shutdown so delivered links do not
break; the operating system owns eventual temp cleanup. There is no configurable
bypass.
