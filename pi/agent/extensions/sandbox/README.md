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
  `~/Library/Caches/ms-playwright` or `~/.cache/ms-playwright`). Write and edit
  access to those roots stays blocked. Bash may name the Volta package root only
  in read-only inspection commands: every command is `cat`, `head`, `tail`,
  `grep`, `rg` (without `--pre`), `ls`, `wc`, `find` (without `-exec`,
  `-delete`, or `-fprint`), `sed` with a print/delete/substitute-only script and
  no `-i`, `cd`, `nl`, `cut`, `tr`, or `jq`; no substitutions, no environment
  assignments, and no output redirection other than to `/dev/null` or another
  descriptor.
- `read`, `grep`, `find`, and `ls` may also access the other worktrees of the
  session root's Git repository, including the main checkout, as listed by
  `git worktree list` (fsmonitor and bare-repository discovery disabled) at each
  check. Bash may name paths there too; because the Bash guard is lexical, that
  includes commands that modify them. `write` and `edit` stay blocked. Listed
  worktrees that contain the home directory or the session root, or that no
  longer hold a `.git` entry, are ignored.
- Sessions started **at the canonical `coding-harness` root** may use `read`,
  `grep`, `find`, and `ls` on `~/.pi/agent/sessions`. This exception does not
  apply from checkout subdirectories or other projects, and the session-store
  root must be an existing non-symlink directory. Recursive `grep`/`find`
  calls fail closed if the requested tree contains symlinks or protected paths;
  direct reads still resolve symlinks before checking. Transcript writes and
  general Bash access remain blocked. Use the read-only discovery helper below
  instead of shell commands on the session store. Eligible Bash denials name the
  approved discovery command and direct the agent to the read tool, rather than
  implying that all transcript access is unavailable. The repository's root
  `AGENTS.md` also includes this workflow so new sessions can find it before a
  denied call.
- Sessions started inside the canonical `coding-harness` checkout or
  `~/pi-plugins` may use all filesystem tools, including writes to normal plugin
  source, across `~/pi-plugins`. This is a scoped development exception for
  user-owned executable package source; it is unavailable to sessions started in
  other projects. Protected secret paths remain denied.
- The canonical personal research vault at `~/research` is resolved before every
  check. Direct `read` calls are automatic; recursive tools retain the ordinary
  approval requirement so they cannot traverse into protected descendants. The
  documented `pdftotext`, `mhtml2txt.py`, and read-only `status.py` forms
  are likewise automatic when run from that root. A `write` or `edit` asks for
  one interactive, per-operation confirmation that names the operation and
  resolved target; the documented `status.py --write-hashes` Bash mutation does
  the same. Denial and non-interactive sessions leave the vault unchanged.
  Protected secret paths remain denied, and a symlink escaping the vault
  receives no grant. Other Bash commands naming the vault remain blocked, so
  this does not grant sibling home-directory access.
- `write` and `edit` are blocked everywhere else outside the session directory,
  resolving existing symlinks and existing parent directories before checking.
- Project-local `AGENTS.md`/`CLAUDE.md` instruction files and the active
  repository's root `.agent/verify.sh` and `.agent/diagnostics.sh` remain
  writable. The verifier scripts are the established cross-harness project
  contract, and Pi's verifier trust gate asks before executing changed content.
  Other agent control-plane writes are restricted to sessions started inside the
  canonical `coding-harness` checkout. Elsewhere, file tools cannot change
  instruction files outside the active project, `.pi` or `.agents` resources,
  nested `.agent/verify.sh` or `.agent/diagnostics.sh`, Git config/hooks, or
  plugin checkout content. Bash may stage the root verifier scripts with `git
  add` or mark them executable with `chmod +x`, but cannot execute them directly;
  execution goes through the verifier trust gate. Bash calls that explicitly name
  other protected paths are blocked; indirect Bash mutation remains subject to
  the lexical-boundary limitation below.
- `.env*`, SSH/cloud credentials, private-key names, credential JSON names,
  keychains, `*.pem`, and `*.key` are hard-denied everywhere, including inside
  the project. The one exception is a regular file named exactly
  `.env.example` inside the session directory that its Git repository tracks
  (`git ls-files` from the session root, with `core.fsmonitor` and bare-repository
  discovery disabled); untracked or ignored copies, symlinks, files tracked only
  by a nested repository, and other names such as `.env.sample` stay denied.
- Bash hard-denies the cross-harness command-safety contract in
  `shared/command-safety.tsv`: privilege escalation, pipe-to-shell execution,
  Git author-identity queries, `Co-Authored-By:`/`Claude-Session:` trailers or
  `claude.ai/code/session_` links in commit, merge, tag, note, and `gh` text, force
  pushes, destructive Git history changes,
  `chmod 777`, deletion outside the workspace or temporary directories, and
  protected-secret access. It returns an actionable reason; `git push
  --force-with-lease` remains permitted.
- Bash is also blocked when it contains an explicit filesystem path outside the
  current, permitted plugin workspace, same-repository worktree, or session temp
  directory, or names a protected secret pattern. Relative paths are resolved
  against the directory each command runs in: a literal `cd` or `pushd` (with
  `~` or `$PI_SESSION_TMPDIR` expanded) moves later commands of the same shell,
  `( … )` and `$( … )` confine their `cd`, and pipeline or background members
  move nothing. Directories resolve physically, so `cd link && cat ../x` is
  checked where the kernel opens it. When a `cd` may not take effect (its target
  does not exist yet, or it runs after `&&`/`||`), commands outside its `&&`
  chain must pass in both directories; `popd` and `cd -` may return to any
  directory seen. A `cd` to an unknown target, such as another variable, leaves
  the tracked directory unchanged. Heredoc bodies are inspected but cannot move
  the shell. `rg` and `grep` search patterns and glob values are not filesystem
  paths, while their explicit file operands remain inspected.
  The research-vault and session-history exceptions are limited to their
  documented commands.
  The exact POSIX null device path is exempt so commands can safely discard output
  or compare against an empty source; neighboring device paths remain blocked.
  Bash does not use the read approval prompt.
- SSH-family commands ask for a one-time `Allow once`/`Deny` confirmation
  showing the full command: `ssh`, `scp`, `sftp`, `sshfs`, `ssh-copy-id`,
  `rsync` with a remote operand or `-e`/`--rsh`, and Git given a custom SSH
  command (`GIT_SSH_COMMAND`, `GIT_SSH`, `core.sshCommand`). A quote-aware
  lexer checks only command words: quoted arguments, comments, arithmetic, and
  heredoc bodies are data, so `git commit -m "fix; ssh"` and `rg 'a|ssh'` do
  not ask. Heredocs fed to a shell (`bash <<EOF`) or never closed are scanned
  as commands, and unquoted heredocs are scanned for substitutions.
  Command words are found after `;`, `&&`, `|`, newlines, shell keywords (`if`,
  `while`, `do`, ...), inside `$(…)` and backticks (also within double
  quotes), in `eval` and `sh|bash -c` scripts, after `find -exec`, and after a
  wrapper's options (`env`, `command`, `timeout`, `xargs`, `nice`, ...).
  A wrapper option that takes a separate value but is missing from the
  wrapper table can hide the wrapped command. Non-interactive sessions
  deny these commands. Ordinary `git push`/`fetch` over an SSH remote is not
  prompted, and SSH started inside scripts or aliases is not detected (see
  boundary limitations).
- State-changing Terraform commands use the same confirmation and detection for
  `terraform`, `tf`, `tofu`, and `terragrunt`: `apply`, `destroy`, `import`,
  `init` (except `init -backend=false`, which only installs providers and
  modules locally; the last `-backend` flag wins), `refresh`, `taint`,
  `untaint`, `force-unlock`, `test`, Terragrunt's
  legacy `apply-all`/`destroy-all`, `state
  mv|rm|push|replace-provider`, and `workspace new|delete`. The first known
  subcommand word decides, so Terragrunt `run-all apply` and flag values are
  handled. Read-only commands such as `fmt`, `validate`, `plan`, `show`,
  `output`, and `state list` run without a prompt.
- Subagents inherit this guard, and their requested working directories must
  remain inside the parent project, the scoped plugin workspace, or the private
  session temp workspace.
- On session startup, the extension changes the Pi agent directory and retained
  session directories to mode 0700, and session transcripts plus local
  credential/configuration JSON files to mode 0600. Symlinks are not followed.

## Session-history discovery

From any Git repository (including a subdirectory), call the model-facing
`recent_sessions` Pi tool with optional `limit` (default 25, range 1–100) to
list the newest top-level Pi sessions started there. The tool returns session
metadata (`path`, `id`, `timestamp`, `cwd`) ordered by session start time.
The equivalent manual CLI remains available:

```bash
bun ~/.pi/agent/extensions/sandbox/session-history.ts --recent --limit 25
```

The CLI prints JSONL metadata. It reads only session headers and includes sessions started
in repository subdirectories, but not other repositories or separate worktrees.
It skips symlinked or protected transcript entries and session directories that
no longer exist. The limit must be 1–100; repositories rooted at the home directory or above
are refused to avoid exposing unrelated projects. This command requires the installed
extension path to resolve to the canonical helper; if Pi is not linked at the
usual path, use the helper's absolute path in the canonical checkout instead.
Use the `read` tool on a returned path to inspect a previous session. The
sandbox permits direct reads of transcript files whose session header records a
working directory in the current repository, including its subdirectories. It
does not grant reads of the session-store directory, symlinked or protected
entries, or other repositories' transcripts; those still need interactive read
approval outside the coding-harness root. Arbitrary Bash access remains blocked.

From the canonical checkout root, search message contents across projects:

```bash
bun pi/agent/extensions/sandbox/session-history.ts --match "playwright" --limit 25
```

The helper prints JSONL metadata (`path`, `id`, `timestamp`, `cwd`) for the newest
matching top-level Pi sessions, ordered by session start time. Matching is a
case-insensitive substring search across message records, including tool calls
and results. It excludes nested subagent transcripts, skips symlinks and
protected paths, and never writes transcripts or reports. Read the returned
paths with the read tool for detailed evidence; transcript contents can still
contain sensitive data.

To audit the newest *unfiltered* top-level Pi sessions by actual tool events:

```bash
bun pi/agent/extensions/sandbox/session-history.ts --audit-bulk-reads --limit 200
```

The first JSONL row summarizes event-bearing sessions in the selected window;
each remaining row reports session id, start time, cwd, whether a user prompt mentions
PI-62/bulk-read, parent `read` tool calls (including blocked calls), broad-read
redirects, bulk-reader dispatches, child successes and failures with known exit
codes, and the count of all later parent `read`
calls after a successful child. The last count does **not** establish rereading
of the child's sources. `coveredParentReads` and `coveredParentReadBytes` count
successful parent reads of paths also successfully read by a prior worker in that
session (Pi's `@` path prefix is normalized; matching is otherwise lexical, not inode-based). `workerCost` sums *verified reported* child dollar costs; `unreportedWorkerCosts` counts runs with missing or inconsistent assistant-turn cost data. A missing cost is never treated as zero (a reported zero is valid). `estimates` contains per-run numeric same-material
comparisons for successful single-agent bulk-reader calls with source reads,
complete worker cost reporting, and recoverable parent prices. Direct cost assumes the
parent ingests every successful worker `read` result once, using 3.6 characters
per token and the parent's reported uncached input rate. Delegated cost adds
reported worker cost, estimated dispatch output at the parent's output rate,
and the returned result text at its input rate. The worker's mandatory
`BULK-READER.md` read is excluded; duplicated source reads, source inspection
by the parent afterward, skill-loading cost, caching, and answer quality are
not modeled. Long child read sequences may not fit in one direct parent context.
The summary reports pooled dollar totals and unweighted per-run mean and
median saving ratios (the midpoint for an even number of runs). Very large
payloads dominate pooled dollars, while tiny reads can produce extreme negative
per-run percentages. Neither is an average net task saving: these models do not
measure what the parent would have chosen to read without the worker.
A dispatch without a known child exit code is neither
success nor failure. Prompt mentions are a coarse experiment hint, not a
reliable exclusion rule. The audit never prints prompts, tool arguments, or
child output. It cannot inspect Claude history, establish whether a child loaded
the shared brief, score answer quality, or prove cost savings. Inspect selected
original records before making those claims.

To count sandbox blocks in the same unfiltered window:

```bash
bun pi/agent/extensions/sandbox/session-history.ts --audit-blocks --limit 200
```

Each JSONL row reports session id, start time, cwd, parent and subagent tool-call
counts, and how many tool results start with `Sandbox blocked tool call:`.
`reasons` groups blocks by tool and reason, with the requested path, resolved
path, and recovery guidance removed; subagent blocks carry a `subagent` prefix.
`targets` maps each reason to the blocked paths' home-relative first two
segments (`<cwd>` for paths inside the session directory). `blockRecords` lists
the record IDs holding a block, for `--session --record` extraction below.
Paths come from the lexical guard, so `sed` addresses and URL fragments appear as
root-level targets. Approved prompts leave no block, so the audit counts only
denials and hard blocks.

To time clarification waits in the same window:

```bash
bun pi/agent/extensions/sandbox/session-history.ts --audit-asks --limit 200
```

Each row lists the session's `ask_question` and `ask_user_question` calls with
the result record ID and the seconds from the asking assistant message to the
answer. Extract a record's `message.content` below to read the question and
answer; the audit itself prints neither.

For a record too large for the read tool's single-line limit, select its session
UUID, record ID (the top-level `id`, not a tool-call ID), and a JSON field:

```bash
bun pi/agent/extensions/sandbox/session-history.ts --session 01a0aaa7-b627-708e-abb1-df479a2162c1 --record 133df9ba --field message.content --offset 0 --limit 2000
```

The helper returns one JSON page with `text`, `totalCharacters`, and `nextOffset`
(`null` at the end). Continue with the returned offset. Fields use dot-separated
object keys or array indexes: `message.content.0.text` selects just the answer;
`message.details.results.0.messages.4` selects one internal worker message.
Strings are returned directly; other JSON values are pretty-printed. Offsets and
limits count JavaScript UTF-16 code units; concatenate decoded `text` pages to
reconstruct the selected value, including any split surrogate pairs. Output is
limited to 2,000 code units per call (below the Bash output cap even with JSON
escaping), not the size of the record parsed in memory. Missing sessions, records,
or fields fail explicitly. Extraction validates the session header and refuses
ambiguous session IDs; it never writes to the store.

The automatic Bash grant accepts only repository-scoped recent listing, discovery,
audit, or extraction in the exact flag order shown (or an absolute canonical helper
path). Only recent listing works outside the canonical checkout root. Audit accepts a limit from
1 to 200. Discovery accepts a literal
query containing letters, digits, spaces, periods, underscores or hyphens, and a
limit from 1 to 100. Extraction accepts a lowercase UUID, an eight-hex-digit
record ID, a field of at most 256 letters/digits/underscores/dots, a nonnegative
safe-integer offset, and a limit from 1 to 2000. No pipes, redirections, shell
expansion, extra flags, or command chaining are granted.
Bun is required. After editing this extension, run `/reload` in Pi to activate
the changed policy; editing the file alone does not update a running guard.

## Boundary limitations

This is a tool-call guard, not an OS sandbox. The command-safety policy uses
lexical inspection: shell syntax it cannot prove or programs that discover paths
at runtime can bypass it. Quoted bodies given to an inline interpreter
evaluation flag (`node`, `bun`, `deno`, `python`, `perl`, `ruby` with `-e`,
`--eval`, `-c`, `-p`, or `--print`) are code, not path arguments, so they are
excluded from path extraction; the equivalent script file was never inspected
either. String literals inside those bodies are still matched against the
protected secret patterns, so inline code that names credentials is denied.
The same masking, with the same secret check, applies to three other kinds of
text:

- closed heredoc bodies with a quoted delimiter fed to those interpreters
  (`python3 - <<'EOF'`) or copied as data by `cat` or `tee`
  (`cat > notes.md <<'EOF'`); unquoted bodies still expand substitutions and
  stay inspected;
- `sed` programs made only of `p`, `d`, `P`, `=`, and `s` commands with line or
  regex addresses, and `awk` programs without `system`, `getline`, `close`, `|`,
  or `>` outside string and regex literals (`||` and `>=` are operators, and a
  `/` opens a regex only where an operand is expected); programs that can read, write, or run files stay inspected, as do `-f`
  program files;
- quoted prose given to `backlog`, `echo`, `printf`, `git -m`/`--message`, or
  `gh` title/body options: a quoted string containing whitespace that has no `$`,
  does not start like a path (`/`, `~`, `./`, `../`), contains no `..` segment,
  names no control path (`.pi`, `.agents`, `AGENTS.md`, `CLAUDE.md`,
  `.agent/verify.sh`, `.git/config`), and is not a redirect target.

Commands
containing ANSI-C `$'…'` strings or substitutions inside double quotes are
inspected without this masking.
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
