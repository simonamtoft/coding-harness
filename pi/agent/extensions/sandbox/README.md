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
- Direct `read` calls are also pre-approved for the canonical
  `coding-harness/shared` tree. Existing symlinks are resolved before this
  check, so reads via the installed `~/.pi/agent/skills` link are checked
  against the shared tree and remain readable without prompting. Recursive
  tools such as `grep` and `find` do not receive this exception, preventing a
  trusted directory root from exposing protected descendants. All read tools
  may inspect installed package content under Volta's `tools/image/packages`
  directory, and Playwright's managed browser cache
  (`PLAYWRIGHT_BROWSERS_PATH` when absolute, otherwise
  `~/Library/Caches/ms-playwright` or `~/.cache/ms-playwright`). Write, edit,
  and Bash access to those roots is unchanged.
- Sessions started inside the canonical `coding-harness` checkout or
  `~/pi-plugins` may use all filesystem tools across `~/pi-plugins`. This is a
  scoped development exception for user-owned executable package source; it is
  unavailable to sessions started in other projects.
- `write` and `edit` are blocked everywhere else outside the session directory,
  resolving existing symlinks and existing parent directories before checking.
- Project-local `AGENTS.md`/`CLAUDE.md` instruction files remain writable.
  Other agent control-plane writes are restricted to sessions started inside the
  canonical `coding-harness` checkout. Elsewhere, file tools cannot change
  instruction files outside the active project, `.pi` or `.agents` resources,
  `.agent/verify.sh`, Git config/hooks, or plugin checkout content. Bash calls
  that explicitly name those protected paths are also blocked; indirect Bash
  mutation remains subject to the lexical-boundary limitation below.
- `.env*`, SSH/cloud credentials, private-key names, credential JSON names,
  keychains, `*.pem`, and `*.key` are hard-denied everywhere, including inside
  the project.
- Bash hard-denies the cross-harness command-safety contract in
  `shared/command-safety.tsv`: privilege escalation, pipe-to-shell execution,
  Git author-identity queries, force pushes, destructive Git history changes,
  `chmod 777`, deletion outside the workspace or temporary directories, and
  protected-secret access. It returns an actionable reason; `git push
  --force-with-lease` remains permitted.
- Bash is also blocked when it contains an explicit path outside the current,
  permitted plugin workspace, or session temp directory; changes its working
  directory to the session temp directory; or names a protected secret pattern.
  The exact POSIX null device path is exempt so commands can safely discard output
  or compare against an empty source; neighboring device paths remain blocked.
  Scratch commands must use absolute paths; Bash does not use the read approval
  prompt.
- Subagents inherit this guard, and their requested working directories must
  remain inside the parent project, the scoped plugin workspace, or the private
  session temp workspace.
- On session startup, the extension changes the Pi agent directory and retained
  session directories to mode 0700, and session transcripts plus local
  credential/configuration JSON files to mode 0600. Symlinks are not followed.

This is a tool-call guard, not an OS sandbox. The command-safety policy uses
lexical inspection: shell syntax it cannot prove or programs that discover paths
at runtime can bypass it. Quoted bodies given to an inline interpreter
evaluation flag (`node`, `bun`, `deno`, `python`, `perl`, `ruby` with `-e`,
`--eval`, `-c`, `-p`, or `--print`) are code, not path arguments, so they are
excluded from path extraction; the equivalent script file was never inspected
either. String literals inside those bodies are still matched against the
protected secret patterns, so inline code that names credentials is denied.
Nested `sh`, `bash`, and `zsh` command strings remain denied outright. Bash commands using variables, redirections, or command
substitution can likewise evade the filesystem check. Use a container, VM, or OS
sandbox when a strong filesystem boundary is required. User-entered `!` commands
and extensions also remain outside this guard.

The session boundary is deliberately fixed to the Pi process's startup cwd.
Trusted locations are derived from the extension checkout, `~/pi-plugins`,
`VOLTA_HOME` (falling back to `~/.volta`), the process temp
directory, and Pi's session UUID. Plugin-workspace access is enabled only when
that startup cwd is inside the extension checkout or plugin workspace.
The temp directory itself is not trusted: the current private session workspace
is fully available, while retained workspaces bypass read prompts only for the
delivered artifact names above. Only the current session workspace accepts
writes. Session workspaces are retained after shutdown so delivered links do not
break; the operating system owns eventual temp cleanup. There is no configurable
bypass.
