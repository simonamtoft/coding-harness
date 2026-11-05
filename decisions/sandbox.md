# Sandbox and command safety

Decision ledger area. Entry ids use the `SBX-` prefix; see `../DECISIONS.md` for the format and append rules.

`pi/agent/extensions/sandbox`, `shared/command-safety.tsv`, `claude/hooks/check-bash.sh`

### SBX-01 · Prompt for outside reads, deny outside writes
`accepted` · 2026-08-24 · `01a03286`
**Decision:** Reads inside cwd are allowed, direct reads outside prompt, edits and writes outside are denied by default.
**Why:** Preserves the project boundary while permitting deliberate, user-approved inspection without granting external write access.
**Revisit if:** A real OS-level boundary or a separate approved-write workflow replaces the lexical guard.

### SBX-02 · Hard-deny secret paths everywhere, including inside cwd
`constraint` · 2026-08-24 · `01a03286`
**Decision:** `.env` and credential/keychain paths are denied even within the working directory and within approved outside-read paths.
**Why:** Explicit user requirement — the project boundary is not a reason to expose secrets.
**Revisit if:** An equally strong centrally enforced mechanism replaces it.
**Evidence:** "We should always deny .env etc. also inside current cwd."
**Exception (2026-10-22, `01a1624d`):** A regular file named exactly `.env.example` inside the session root that the session's Git repository tracks is exempt for reads, edits, and Bash. Untracked or ignored copies, symlinks, files tracked only by a nested repository, and other template names (`.env.sample`, `.env.template`) stay denied. Narrowed again by SBX-30. The tracking check runs `git ls-files` from the session root with `core.fsmonitor` and bare-repository discovery disabled, so an attacker-controlled repository's config cannot run commands during a path check. A Paseo session hit the block four times documenting a config key and began probing for workarounds. User: "exempt ONLY the file named EXACTLY .env.example, and only if tracked by git".

### SBX-03 · Bash gets denial only, never the read prompt
`accepted` · 2026-08-24 · `01a03286`
**Decision:** Do not extend the outside-read approval prompt to Bash; deny Bash commands containing identifiable outside paths.
**Why:** Shell commands reach files through variables, substitution, and dynamic discovery, so prompting on partially recognized paths gives false assurance.
**Revisit if:** Bash execution moves into a real sandbox with reliable path mediation.

### SBX-04 · Private per-session workspace, not the shared temp directory
`accepted` · 2026-08-24 · `01a03397`
**Decision:** Each session gets a mode-0700 workspace keyed by session UUID, exposed as `PI_SESSION_TMPDIR`. Arbitrary `$TMPDIR` paths stay restricted; predictable handoff/report filenames were explicitly rejected as too broad.
**Why:** Predictable names in a shared temp directory are attacker-controllable and would bypass the outside-read prompt.
**Revisit if:** Pi provides a native private scratch directory with equivalent guarantees.

### SBX-05 · Cross-session reads are limited to delivered artifacts
`accepted` · 2026-08-24 · `01a03397`
**Decision:** Reads into other retained session workspaces are permitted only for final reports, report capture directories, handoff Markdown, and retrospectives. Retained-session writes stay blocked.
**Why:** Trusting every file in another workspace would indefinitely bypass approval for arbitrary content.
**Revisit if:** Retained workspaces gain artifact provenance or explicit sharing.
**Note:** Subagents get their own session workspace and cannot read the parent's. Stage shared inputs inside the repository (a gitignored `.agent-report*/` path) when dispatching them.

### SBX-06 · Trust direct reads of the shared tree, not recursive tools
`accepted` · 2026-08-26 · `01a03cf5`
**Decision:** Pre-approve direct `read` under the canonical `coding-harness/shared` tree (including symlink-resolved Pi skills); do not extend it to `grep` or `find`. The separate trusted `~/.pi/agent/skills` root was removed as redundant once paths are canonicalized.
**Why:** Recursive tools could traverse into a protected descendant such as a secret file.
**Revisit if:** Recursive access can be constrained without weakening secret-path protection.

### SBX-07 · Control-plane writes only from ~/coding-harness
`constraint` · 2026-08-26 · `01a03f74`
**Decision:** Writes to agent instructions, extensions, verifiers, and Git hooks are permitted only when Pi starts inside `~/coding-harness` — not from plugin repositories or arbitrary workspaces. Project-local `AGENTS.md`/`CLAUDE.md` were later exempted (`01a04ffd`) because the guard wrongly protected a project's own instruction files.
**Why:** The narrow repository-specific exception was chosen over a general capability.
**Revisit if:** Another trusted development root needs equivalent maintenance access.

### SBX-08 · Trusted plugin access is location-scoped
`constraint` · 2026-08-25 · `01a0386d`
**Decision:** `~/pi-plugins` is accessible only when Pi runs from `~/pi-plugins` or `~/coding-harness`; secret-path blocking still applies.
**Why:** Plugin development happens in two known locations; global access was not wanted.
**Revisit if:** Another explicitly trusted root starts plugin work.

### SBX-09 · Inline interpreter bodies are code, not filesystem arguments
`accepted` · 2026-08-30 · `01a05451`
**Decision:** `node`/`bun`/`deno`/`python`/`perl`/`ruby` inline eval bodies are excluded from path extraction but still scanned for protected secret paths.
**Why:** The documented Playwright screenshot expression was falsely parsed as a path and blocked by our own sandbox.
**Revisit if:** The parser can distinguish code literals from real filesystem arguments.

### SBX-10 · Playwright browser caches are read-only accessible
`constraint` · 2026-08-30 · `01a05451`
**Decision:** `read`, `grep`, `find`, `ls` may reach `PLAYWRIGHT_BROWSERS_PATH` and the macOS/Linux default cache paths without prompting. Writes and Bash are unchanged.
**Why:** Chosen deliberately over broadening sandbox access generally.
**Revisit if:** Playwright needs write or Bash access to those paths.

### SBX-11 · Block Git author-identity queries, keep ordinary config reads
`constraint` · 2026-08-31 · `01a0573a`
**Decision:** Hard-block commands querying Git author identity, identity variables, and broad config listings; keep targeted reads such as `git config --get core.editor` allowed.
**Why:** Those commands exposed personal identity information with no legitimate agent purpose.
**Revisit if:** A trusted workflow genuinely requires identity inspection.
**Evidence:** "Whatever could be the reason to invoke these? I think they should be blocked commands."

### SBX-12 · Share the command-safety contract, not the enforcement code
`accepted` · 2026-08-26 · `01a03f17`
**Decision:** `shared/command-safety.tsv` holds the harness-neutral deny policy and regression fixtures; Pi (TypeScript extension) and Claude (Bash hook) keep separate enforcement.
**Why:** Claude receives JSON through a Bash hook while Pi intercepts tool calls in TypeScript; a shared parser would be brittle.
**Revisit if:** Both harnesses adopt a common policy engine.

### SBX-13 · The lexical guard is defense-in-depth, not isolation
`constraint` · 2026-08-26 · `01a03f17`, `01a03f74`
**Decision:** OS-level sandboxing is deferred to a separate investigation (PI-26) covering a Nix-defined container or VM and macOS Seatbelt. Tool-call inspection is not treated as an OS boundary.
**Why:** Inspection cannot constrain subprocesses, shell indirection, extensions, or user commands; Nix gives reproducibility, not runtime isolation.
**Revisit if:** A disposable isolation launcher with explicit filesystem, credential, network, and rollback policy is designed.

### SBX-14 · User-mediated research-vault access
`accepted` · 2026-09-03 · `01a068b2`
**Decision:** The canonical personal research vault is a location-scoped exception: direct filesystem reads and its documented read-only ingestion/status commands are automatic, while file mutations and the documented hash-stamping Bash command need an interactive, one-time confirmation. Other Bash commands naming the vault remain blocked.
**Why:** Durable research needs efficient access to its raw material and notes, but allowing a general external-write or Bash exception would weaken the project boundary. Resolving documented command operands before checking preserves secret-path denial and prevents a vault symlink from granting access elsewhere.
**Revisit if:** The vault moves, gains a machine-enforced capability boundary, or its documented command workflow changes.

### SBX-15 · Permit only root verifier-contract scripts
`accepted` · 2026-09-08 · `01a081d6`
**Decision:** Sessions outside `coding-harness` may modify only their active repository's `.agent/verify.sh` and `.agent/diagnostics.sh`; Bash may stage them or mark them executable but cannot execute them directly. Nested copies and other control-plane paths remain restricted.
**Why:** These two scripts are the documented cross-harness verifier contract, and blocking them prevented normal commits. Moving the contract would add churn without strengthening the boundary because the existing writable Taskfile `verify` fallback has equivalent execution capability. Pi's verifier trust gate approves repository-controlled verifier content before execution, so the Bash exception must not bypass that gate.
**Revisit if:** The verifier contract no longer uses these project-root scripts, or verification execution receives a stronger isolated trust boundary.

### SBX-16 · Session-history inspection belongs to harness maintenance
`accepted` · 2026-09-13 · `01a09c5b`
**Decision:** Permit Pi transcript read tools and a literal read-only discovery command only from the canonical coding-harness root. General outside Bash access, transcript writes, and grants from other projects remain refused.
**Why:** Reviewing recent sessions is necessary to improve the harness, but ordinary project work should not automatically see unrelated conversations. The user explicitly chose a bounded analysis helper rather than weakening the general Bash boundary.
**Revisit if:** Session analysis needs additional read-only operations or another explicitly trusted maintenance root.
**Evidence:** "allow reads of ~/.pi/agent/sessions when the current folder is ~/coding-harness"; "Read tools + analysis helper".

### SBX-17 · Allowlist Node-based shared skill helpers
`accepted` · 2026-09-14 · `01a09ecb`
**Decision:** Permit only `visual-verification`'s `capture-pages.mjs` and `capture-scenario.mjs` as Node helpers in the canonical shared skill tree; keep the existing shell-helper rule and refuse other shared `.mjs` files.
**Why:** The visual-capture runners need direct Bash execution from project sessions. Trusting every shared Node helper would let a helper with manifest-controlled indirect reads bypass the guard's protected-path checks; an explicit allowlist preserves the shared-tree, symlink-resolution, and secret-path constraints.
**Revisit if:** Another Node shared helper demonstrates a project-session execution need and restricts indirect filesystem inputs safely.

### SBX-18 · Plugin workspaces are editable from trusted plugin sessions
`accepted` · 2026-09-16 · `01a0aa33`
**Decision:** Permit normal writes anywhere under `~/pi-plugins` when Pi starts in `~/pi-plugins` or the canonical `~/coding-harness` checkout. Keep plugin writes blocked from unrelated project sessions and retain secret-path denial everywhere.
**Why:** Treating all plugin source as control-plane content prevented ordinary plugin development in its own trusted workspace. The existing location-scoped plugin access boundary is sufficient to distinguish that work from unrelated projects.
**Revisit if:** Plugin source moves outside the trusted workspace or receives a stronger machine-enforced trust boundary.

### SBX-19 · Bounded session-field extraction, not general shell access
`accepted` · 2026-09-16 · `01a0aa6e-cecf-7666-a2e3-fc8aff4b3c5e`
**Decision:** Extend the root-scoped session-history helper with literal session ID, record ID, field, offset, and limit arguments. Return a bounded page of the selected JSON field, so worker answers and individual internal messages can be inspected separately. Retain existing protected-path and symlink exclusions, no transcript writes, and no general Bash grant.
**Why:** Bulk-reader results in the supplied trial sessions occupy single 222–303 KB JSONL lines. The read tool cannot return even one such line under its 50 KB cap, and smaller line limits cannot recover the final answer. Field extraction avoids copying the entire record or weakening the shell boundary; the original record remains unchanged.
**Revisit if:** Pi supplies native bounded JSON-field reads or session records no longer embed oversized child histories.
**Evidence:** "Extend the helper"

### SBX-20 · Bonsai trials retain the existing Pi guard
`accepted` · 2026-09-18 · `01a0b4b8`
**Decision:** PI-75 trials must retain the existing tool-call guard, including minimal-harness trials that otherwise disable extension discovery. Do not make OS confinement a prerequisite for this local-model experiment; retain SBX-13's distinction between inspection and isolation.
**Why:** The baseline launcher accidentally disabled the guard together with unrelated extensions. The user chose normal Pi protections for continued tuning rather than expanding the experiment into a new isolation environment. Generated programs and operator-run tests still execute with host permissions; disposable fixtures are not a security boundary.
**Revisit if:** Trials need to execute untrusted repository content under an enforced filesystem/process boundary, or the separate isolation work provides a verified launcher.
**Evidence:** "Yes let's use existing guards in every trial."

### SBX-21 · Repository-scoped recent session metadata outside harness maintenance
`accepted` · 2026-10-03 · `01a1039d`
**Decision:** Permit a literal bounded recent-session listing from any Git repository and direct read-tool access to transcript files whose session headers identify that repository. Keep cross-project content search, other transcript reads, extraction, directory traversal, and general session-store access restricted to the canonical coding-harness root or existing interactive read approval.
**Why:** Agents need to discover and inspect their own recent work for analysis without gaining the global transcript access that SBX-16 reserved for harness maintenance. Repository-scoped header checks preserve that boundary while making local session analysis practical.
**Revisit if:** Project-level session analysis needs unattended transcript reads or repository identity can no longer be inferred reliably from recorded working directories.
**Evidence:** "Current repo only"

### SBX-22 · Confirm visible SSH-family commands in Pi
`accepted` · 2026-10-12 · `01a13088`
**Decision:** The Pi guard asks `Allow once`/`Deny` before Bash commands that visibly invoke `ssh`, `scp`, `sftp`, `sshfs`, `ssh-copy-id`, remote `rsync`, or Git with a custom SSH command; non-interactive sessions deny them. Rejected: prompting on Git network operations (push/fetch/clone), per-host session approval, and a matching Claude hook or `ask` class in `shared/command-safety.tsv`.
**Why:** Unlike Claude's Seatbelt, Pi leaves `~/.ssh` keys and the SSH agent reachable to subprocesses, so remote access needed a user checkpoint. Git prompts would fire on most pushes while still missing Git invoked by scripts; per-host approval needs fragile host parsing; Claude already falls back to a permission prompt when sandboxed SSH cannot read keys. Like SBX-14, this is a lexical deterrent, not isolation (SBX-13).
**Revisit if:** Pi Bash gains OS-level isolation (PI-26), or SSH prompts prove too noisy or too easy to bypass in practice.
**Evidence:** "perhaps we can do some approval extension. E.g. that it asks for permission every time it tries to run an ssh command"

### SBX-23 · Confirm state-changing Terraform commands in Pi
`accepted` · 2026-10-19 · `01a1546f`
**Decision:** The SBX-22 confirmation also covers state-changing `terraform`, `tf`, `tofu`, and `terragrunt` subcommands (`apply`, `destroy`, `import`, `init`, `refresh`, `taint`, `untaint`, `force-unlock`, `test`, mutating `state` and `workspace` subcommands). Rejected: prompting on every Terraform call, and changing Claude's hook, which already auto-allows read-only Terraform and prompts for everything else.
**Why:** Read-only `fmt`, `validate`, and `plan` belong to the verify loop, so prompting on them would be noise; the state-changing set mirrors Claude's split.
**Revisit if:** Terraform prompts prove too noisy, or Pi Bash gains OS-level isolation (PI-26).
**Evidence:** "State-changing only"; "these, and also alias such as tf"
**Narrowed by SBX-26:** `init -backend=false` no longer asks.

### SBX-24 · Match confirmation commands by command word, not substring
`accepted` · 2026-10-19 · `01a1546f`
**Decision:** The SBX-22/SBX-23 confirmation uses a quote-aware lexer and checks only command words, including those in substitutions, `eval`, `sh -c`, `find -exec`, and after parsed wrapper options. Reversed: splitting on operators before honouring quotes, and treating every word after a wrapper as a possible command.
**Why:** The old matching prompted on quoted text such as commit messages, `rg` patterns, and heredoc bodies, which made the prompt noise. The cost is that a wrapper option missing from the value-option table can hide the wrapped command; that miss is a lexical deterrent limitation, as SBX-13 already accepts.
**Revisit if:** Missed invocations through unlisted wrapper options appear in practice, or a real shell parser becomes available to the extension.
**Evidence:** "I think the ssh command eagerly triggers. E.g. also just if the text string contains ssh itself."

### SBX-25 · Block agent attribution and session links at the agent's command layer
`accepted` · 2026-10-23 · `01a1639c`
**Decision:** The shared command-safety contract hard-denies `git commit`/`commit-tree`/`merge`/`tag`/`notes` and `gh pr`/`issue`/`release`/`api` commands whose text contains a `Co-Authored-By` trailer (`:` or `--trailer` `=` form), `Claude-Session:`, or `claude.ai/code/session_`. Rejected: a Git `commit-msg` hook (repository-local or a global `core.hooksPath`), and blocking all URLs in messages.
**Why:** Claude Code cloud sessions put session links in public `cv-website` commits and PR bodies; a session shared later would expose its whole transcript to any claude.ai account. A Git hook misses PR bodies, and a global hooks path disables repositories' own hooks unless it chains them. Ordinary URLs are legitimate. Message files (`-F`, `--body-file`) and cloud sessions, which run neither guard, remain uncovered; cloud repositories need `{"attribution": false}` in their `.claude/settings.json`.
**Revisit if:** Agents start writing messages through files, cloud sessions gain a local enforcement point, or human co-author credit becomes needed in agent commits.
**Evidence:** "Agent-side only"; "Session links + co-author"

### SBX-26 · Local-only `terraform init -backend=false` runs without confirmation
`accepted` · 2026-10-26 · `01a17808-2481-773e-9c33-22920020616d` · Superseded by SBX-32
**Decision:** `terraform init` (and `tf`, `tofu`, `terragrunt`) skips the SBX-23 confirmation when its last `-backend` flag is `-backend=false`. Other `init` forms keep it. Refused: auto-allowing every `init`, and every `init` except `-migrate-state`/`-force-copy`.
**Why:** An unanswered confirmation for a local-only init stalled a Paseo turn for 2.1 h. With the backend disabled, init only downloads providers and modules into `.terraform`, so the prompt protected nothing. The user chose the narrowest form.
**Revisit if:** Backend-configuring inits also prove noisy, or Pi Bash gains OS-level isolation (PI-26).
**Evidence:** The user chose "-backend=false only".

### SBX-27 · Track literal `cd` instead of blocking `cd` into the session temp directory
`accepted` · 2026-10-26 · `01a17808-2481-773e-9c33-22920020616d`
**Decision:** The Bash path check resolves relative paths against the directory each command runs in. Literal `cd`/`pushd` targets (with `~` and `$PI_SESSION_TMPDIR` expanded) move later commands; subshells and command substitutions confine their `cd`; pipeline members move nothing; a `cd` that may not take effect makes later commands pass in both directories; and `popd`/`cd -` may return to any directory seen. Directories resolve physically. Heredoc bodies stay inspected but cannot move the shell. The blanket block on `cd` into the session temp directory, and the system-prompt sentence telling agents to avoid it, are removed. A `cd` to an unknown target still leaves the tracked directory unchanged.
**Why:** Of 182 sandbox blocks in the 50 newest Paseo sessions, about 40 came from resolving `cd sub && tool ../x` against the session root or from the `cd`-to-temp block. The temp-directory block existed only because relative paths after that `cd` were resolved against the root. Tracking the directory fixes both and also catches `cd link && cat ../x` through a symlinked directory, which the root-relative check allowed.
**Revisit if:** Pi Bash gains OS-level isolation (PI-26), or dynamic `cd` targets become a common source of false denials.

### SBX-28 · Same-repository worktrees are readable and Bash-addressable, not editable
`accepted` · 2026-10-26 · `01a17808-2481-773e-9c33-22920020616d`
**Decision:** The read tools and Bash may reference the main checkout and other worktrees that `git worktree list` reports for the session root's repository, recomputed on every check. `write` and `edit` stay blocked there. Listed worktrees that contain the home directory or the session root, or that lack a `.git` entry, are ignored. Refused: treating sibling worktrees like the session root, and read-tool-only access.
**Why:** Paseo runs each task in its own worktree, and merge and comparison work needs to inspect the siblings; 14 blocks in the analysed sessions were of this kind. The lexical Bash guard cannot make Bash read-only, so Bash access implies possible modification; the user accepted that for Bash while keeping file-tool edits blocked.
**Revisit if:** A session modifies a sibling worktree unintentionally, or Pi Bash gains OS-level isolation (PI-26).
**Evidence:** The user chose "Bash + read, no edits" and asked that access stay "boxed within current repo or similar".

### SBX-29 · Read-only Bash inspection of installed Pi packages
`accepted` · 2026-10-26 · `01a17808-2481-773e-9c33-22920020616d`
**Decision:** Bash may name the Volta package root (installed Pi docs and code) only when every command in the line is a listed inspection program without writing options, substitutions, environment assignments, or output redirection other than to `/dev/null` or another descriptor. Any other command naming that root stays blocked.
**Why:** The system prompt sends agents to the Pi docs, but `grep` over them was blocked eight times in the analysed sessions. The read tools already had this access (SBX-06's read-only trust model), and the root holds executable harness code, so Bash gets inspection only.
**Revisit if:** Agents need other tools there, or the allowlist is shown to permit a write.

### SBX-30 · Bash may mention `.env*` names it does not open
`accepted` · 2026-11-03 · `01a1a06f`
**Decision:** Relative `.env*` paths (no `..`, `~`, absolute path, or expansion, and no other protected name) are not secret blocks when they are operands of `ls`, unary `test`/`[`/`[[` file tests, `git check-ignore`, or `find -name`/`-path` patterns, provided that command is not piped or substituted and `find` has no `-exec`, `-delete`, or file-writing action; or when they appear inside quoted text given to `backlog`, `git -m`/`--message`, or `gh` title/body options. Reading contents (`cat`, `source`, interpreter code), redirecting into them, `echo`/`printf` text, and data heredocs stay blocked. Considered: existence probes only, or keeping SBX-02 fully strict.
**Why:** In the 55 sessions after PI-112, about 15 of 91 blocks were existence checks or task-plan and commit text mentioning `.env`; agents then renamed fixtures to `vars.txt` to work around the guard. None of the exempted forms opens the file. A pipeline or substitution could turn probe output or printed text into a reader's operands, so those stay checked; a two-step indirection through a temporary file remains possible, as SBX-13 already accepts for the lexical guard.
**Revisit if:** An agent reads `.env` contents through one of the exempted forms, or Pi Bash gains OS-level isolation (PI-26).
**Evidence:** The user chose "Checks + quoted text".

### SBX-31 · Sibling repositories stay outside Bash
`rejected` · 2026-11-03 · `01a1a06f`
**Decision:** Do not give Bash read-only inspection of `~/projects/*` siblings in the style of SBX-29. The read tool keeps its approval prompt (SBX-01) and Bash keeps denial (SBX-03).
**Why:** The about 12 recent blocks all came from one repository-migration week, when content moved from `nlp-claims` and `call-transcription-and-summarization` into `nlp-ai-pocs`. Cross-repository work can start Pi in the common parent instead.
**Revisit if:** Sibling-repository blocks recur outside one-off migrations.
**Evidence:** The user chose "Keep blocked".

### SBX-32 · `terraform init` needs confirmation only when it can migrate state
`accepted` · 2026-11-03 · `01a1a06d-b69f-7118-8fa7-d3cf1b87d12a`
**Decision:** `terraform init` (and `tf`, `tofu`, `terragrunt`) runs without confirmation when `-backend=false` is in effect, or when `-input=false` is in effect, neither `-migrate-state` nor `-force-copy` is, and the command text does not mention `TF_CLI_ARGS` (last occurrence of each flag wins; `=false`/`=0` disables). Backend-configuring forms such as `-backend-config=…`, `-reconfigure`, and `-upgrade` qualify with `-input=false`. The other SBX-23 subcommands keep confirmation; `terraform test` stays confirmed because its run blocks apply real infrastructure unless every block uses `plan` or mocks, which the lexical guard cannot see. Reverses the 2026-10-26 refusal recorded in SBX-26. Refused after review: the user-approved narrower rule of confirming only `-migrate-state`/`-force-copy`, because `TF_CLI_ARGS`/`TF_CLI_ARGS_init` can append those flags and a piped answer (`yes | terraform init`) can accept the migration prompt when input is enabled.
**Why:** In the 50 newest Paseo sessions, 6 of 22 Terraform confirmations were backend inits, waiting 61–1,614 s; Paseo shows the agent as running while the prompt waits, so the wait reads as a hung command. With `-input=false` Terraform errors instead of prompting, so only the explicit flags can migrate state. Other init effects (`.terraform/`, `.terraform.lock.hcl`) are local and visible in Git. Inits without `-input=false` still prompt.
**Revisit if:** An unconfirmed init changes remote state, agents routinely omit `-input=false` so the prompt stays noisy, or Pi Bash gains OS-level isolation (PI-26).
**Evidence:** The user chose "Allow init"; the security review of the first implementation found the `TF_CLI_ARGS` and piped-input paths.

### SBX-33 · OS-level isolation runs the Paseo daemon inside a Colima container
`accepted` · 2026-11-03 · `01a1a06c-984b-7288-b4be-2a71a5f228ac`
**Decision:** Isolated agent runs use `paseo/box/`: a second Paseo daemon with Pi in a Linux container on Colima, added to the Paseo app as a direct-connection host, with a default-deny egress firewall applied by root before Paseo drops to an unprivileged user. Refused: the host daemon launching Pi through a `docker exec` wrapper (Paseo terminals and setup hooks would stay on the host); VS Code devcontainers as the workflow (the user drives agents from Paseo, not an editor); Docker Desktop as the runtime (a paid subscription at Implement's size, and the user prefers Colima); OrbStack (paid for commercial use); Apple `container` (no Docker API or devcontainer support); Anthropic's reference firewall script (all rights reserved; `firewall.sh` is independent and also drops its any-host SSH rule).
**Why:** The container boundary covers everything Paseo launches, which the lexical guard cannot (SBX-13). Measured on the M4: Colima's bind mounts and volumes were faster than Docker Desktop's, and the repository checks passed in the box faster than on the host.
**Revisit if:** Paseo gains a native sandbox for agents, Colima stops supporting `vz` with virtiofs, or the box's firewall proves too coarse.
**Evidence:** The user chose "A: daemon in container" and asked to use Colima.

### SBX-34 · The box reads the Pi setup and local Pi files read-only
`accepted` · 2026-11-03 · `01a1a06c-984b-7288-b4be-2a71a5f228ac`
**Decision:** The box mounts this repository and `~/pi-plugins` read-only and runs `link.sh --packages` inside, so agents load the same setup but cannot change it. `models.json` and `settings.json` reach the box as copies that `paseo-box.sh` refreshes on every start into `~/.config/paseo-box/pi`, which is mounted read-only; the daemon password sits outside that folder. The entrypoint resets the home directory as root on every start, persisting only the Pi sign-in, Pi sessions and Paseo state, because Pi auto-loads agent-directory files (`APPEND_SYSTEM.md`, themes) and `~/.agents/skills`. Refused: symlinks to `~/.pi/agent` (Colima resolves them inside the VM, where they break); mounting `~/.pi/agent` into the VM (it exposes sessions and `auth.json` to the VM); the box's own `settings.json` from the example (the user wanted their real preferences, whose package entry needs `~/pi-plugins`).
**Why:** Agents that can write their own instructions, extensions or `link.sh` could disable the controls meant to contain them.
**Revisit if:** Pi supports a read-only configuration root, or the copies drift in ways that a restart does not fix.
**Evidence:** The user chose "Read-only mount", then "B: copy, then mount" and "Real + pi-plugins".

### SBX-35 · Box credentials: own Pi sign-in and passed API keys only
`accepted` · 2026-11-03 · `01a1a06c-984b-7288-b4be-2a71a5f228ac`
**Decision:** Pi signs in to Anthropic separately inside the box, and the launcher passes only `IM_GPT_API_KEY` and `HETZNER_API_KEY`. No SSH keys, Git credentials, cloud CLI configuration or Docker socket enter the box. Refused: copying `auth.json` from the Mac.
**Why:** Sharing OAuth tokens means a refresh in the box may rotate them and sign the Mac out (inferred from OAuth behaviour, not verified for Pi), and the box should hold no more than it needs to call models.
**Revisit if:** Pi supports scoped or per-device tokens, or a separate sign-in becomes a burden.
**Evidence:** The user chose "Separate /login" and both API keys.

### SBX-36 · The box edits the mounted checkout but cannot write its `.git`
`accepted` · 2026-11-03 · `01a1a06c-984b-7288-b4be-2a71a5f228ac`
**Decision:** The box mounts the checkout being worked on at `/workspace` on its current branch, with the whole `.git` directory read-only; agents edit files, while commits, branches and Paseo worktrees happen on the Mac or the host Paseo daemon. The launcher refuses linked worktrees. Refused: read-only `.git/hooks` and `.git/config` only (the first implementation; the security review showed, and a reproduction with Git 2.53 confirmed, that a planted `.git/commondir` makes a plain `git status` on the Mac run the agent's `core.fsmonitor`); a separate clone inside the box (keeps commits and worktrees, but loses live edits to the current checkout); accepting the risk.
**Why:** Git on the Mac executes what `.git` says, and the checkout is the one host path agents can write.
**Revisit if:** Agents in the box need to commit routinely, or Paseo supports worktrees whose Git data stays outside the Mac checkout.
**Evidence:** The user chose to "use current checkout / branch we work on", then "A: read-only .git" after the review.

### SBX-37 · Kernel-confine each Pi command, not the whole Pi process
`accepted` · 2026-11-04 · `01a1a759-7e9c-728e-8edb-03e25618abf1`
**Decision:** On macOS the sandbox extension runs every model `bash` call and user `!` command under a Seatbelt profile it generates and passes to `/usr/bin/sandbox-exec`: home reads denied except an allowlist, Pi's `auth.json` and secret file names denied, writes limited to the checkout, temp and cache directories, localhost, LaunchServices and Apple Events denied, renames that would sidestep path rules denied, and credential-like environment variables and shell startup hooks removed. It refuses to run commands when `sandbox-exec` is missing; `PI_COMMAND_SANDBOX=off` is the explicit opt-out. Refused: nono and Anthropic's sandbox-runtime (both wrap Seatbelt; a dependency for about 200 lines of profile code, and nono confines the whole process); a whole-process sandbox first (a confined process cannot apply a different profile, measured as `sandbox_apply: Operation not permitted`, so commands would inherit Pi's read access to `auth.json`); an allow-by-default read policy (leaves sibling projects readable).
**Why:** The lexical guard is not isolation (SBX-13); kernel confinement of commands closes subprocess and shell-indirection reads (PI-106) and SSH private-key reads (SBX-22) while keeping Pi's credentials out of reach and needing no launcher, so it applies to terminal, Paseo and subagent sessions automatically. Pi's own tools, extensions and MCP servers remain behind the lexical guard only.
**Revisit if:** PI-125 adds a whole-process sandbox with a command broker, macOS removes `sandbox-exec`, or the allowlist breaks routine commands often enough that tuning outweighs the protection.
**Evidence:** The user chose "Bash-only first", "Build our own", "Files now, proxy next" and "Deny by default".

### SBX-38 · Azure CLI credentials only for approved commands
`accepted` · 2026-11-04 · `01a1a759-7e9c-728e-8edb-03e25618abf1`
**Decision:** The kernel command profile denies `~/.azure`. A model command whose command word is `az` or a Terraform program asks the user, with `Allow once`, `Allow Azure for this session` and `Deny`; an approval adds `~/.azure` read and write to that one command's profile. User `!` commands get it without a prompt. Refused: always allowing `~/.azure` (every command, including package install scripts, could read Azure refresh tokens while egress is open); a per-project opt-in (same exposure inside opted-in projects, plus configuration).
**Why:** Azure tokens reach further than any other credential on the machine, and approval on visible commands matches SBX-22 and SBX-23. Scripts that call `az` internally run without the credentials and fail closed.
**Revisit if:** PI-124 restricts egress enough that a leaked token cannot leave, or approval prompts for `terraform plan` become a burden.
**Evidence:** The user asked to "do the az allow".

### SBX-39 · Docker stays outside the command sandbox
`accepted` · 2026-11-04 · `01a1a759-7e9c-728e-8edb-03e25618abf1`
**Decision:** Sandboxed commands cannot reach `~/.docker`, the Colima socket or `/var/run/docker.sock`; the user runs Docker commands manually. Refused: approval-gated socket access, because an approved command can mount the home directory into a container and so is unconfined in practice.
**Why:** Access to the Docker socket gives control of the host, so any socket grant voids the profile for that command.
**Revisit if:** agents routinely need containers (for example test databases), in which case use paseo-box or an approval that states the command runs with full host access.
**Evidence:** The user chose to "do the docker stuff manually".

### SBX-40 · Allowlist the present report scripts as Node helpers
`accepted` · 2026-11-04 · `01a1a7db-c13e-773a-940d-0554c9462f20`
**Decision:** Extend SBX-17's allowlist with `present`'s `build-report.mjs`, `validate-report.mjs`, and `render-report.mjs`. Each restricts its own indirect inputs. `build-report.mjs` embeds only real image files (checked by signature) from the session temporary directory or the current repository. It runs Git only on the repository it was started in, for repository-relative, non-secret paths at plain revisions, and writes only inside the session temporary directory. `render-report.mjs` reads and writes only inside the session temporary directory, and both browser pages abort network requests. Refused: leaving `present` unusable outside coding-harness sessions.
**Why:** The presenter runs in project sessions, and SBX-17's revisit condition is a Node helper that has a project-session need and restricts its indirect filesystem inputs safely. Regression tests in `build-report.test.mjs` cover each restriction.
**Revisit if:** The spec gains a field that reads other files, or the scripts need to read outside these roots.
**Evidence:** The user chose "Allowlist, restricted".

### SBX-41 · Model commands reach the network only through an in-process hostname allowlist proxy
`accepted` · 2026-11-04 · `01a1a87a-36ee-7452-a1db-ef508ab8ca47`
**Decision:** The sandbox extension runs an HTTP CONNECT proxy inside the unconfined Pi process on an ephemeral loopback port, and a model command's Seatbelt profile denies every outbound IP connection except that port and the local service ports 3000, 4173, 5173, 8000 and 8080. The proxy tunnels only to allowlisted hostnames: HTTPS hosts of the model providers Pi has credentials for, the npm and PyPI registries, and GitHub (also `github.com:22` for Git over SSH). It refuses everything else, including IP literals, plain HTTP (also inside a port-443 tunnel) and names resolving to special-purpose addresses. A command approved for Azure credentials (SBX-38) also gets Azure and HashiCorp hosts through a proxy token revoked when that Bash call returns. User `!` commands keep open egress; a Pi started from one refuses its model's Bash commands because it cannot restrict their egress. DNS stays open. Refused: prompting for unlisted hosts (the acceptance criteria require refusal; a code change or an unconfined terminal covers the long tail); allowlisting `!` commands; blocking the mDNSResponder socket (tools that resolve before proxying would break); allowing port 5000 (macOS AirPlay Receiver listens there); a third-party proxy or srt (one dependency for about 250 lines, and srt confines whole processes, see SBX-37).
**Why:** Seatbelt filters only by IP and port and rejects hostnames in network rules (measured: "host must be * or localhost"), so hostname control needs a proxy that commands cannot bypass. Running it in Pi's process means no launcher, and it ends with the session.
**Revisit if:** PI-125 confines the whole Pi process (the proxy must then run outside it), refusals of legitimate hosts become frequent enough to justify a prompt or configuration, or DNS exfiltration becomes a practical concern.
**Evidence:** The user chose "Open egress for !", "Refuse only" with a localhost port list, "Add for approved cmds", "Keep DNS, document gap", "Add to PI-124" and "Same without 5000".

### SBX-42 · Projects may write their own `verify-*` skills
`accepted` · 2026-11-05 · `01a1ab54-8686-73a0-886b-fc93ca6cb7d0`
**Decision:** Outside coding-harness sessions, file tools and Bash may write and run files in a `.agents/skills/verify-<app>/` directory at any depth inside the session root, unless the rest of the path has its own control segment (`.pi`, `.agents`, `.git/config`, `.git/hooks`). Existence probes that only mention a relative control path, such as a `find -path` pattern naming `.agents`, are no longer path candidates when the command has no pipe, substitution or redirection; stored prose still is, because `git checkout -m` takes a path. Refused: unlocking all of `.agents/skills` (wider persistence surface than the need); leaving the block and having the user copy a staged skill in (contradicts the `project-flow-verification` contract).
**Why:** SBX-07 blocked the artifact location that `project-flow-verification` requires, so a health-claims verification run could not create its skill. The persistence risk equals that of project `AGENTS.md`, which is already writable.
**Revisit if:** project-flow-verification moves its artifact, or project skills other than `verify-*` need agent authoring.
**Evidence:** The user chose "verify-* only".

### SBX-43 · Read-only access to certifi's CA bundle inside projects
`accepted` · 2026-11-05 · `01a1ab54-8686-73a0-886b-fc93ca6cb7d0`
**Decision:** The kernel profile lets commands read, but not write, any `certifi/cacert.pem` under the secret-scan roots, except below a credential directory; other `.pem` names stay denied. Creating or renaming any `certifi` directory there is denied, so an existing `cacert.pem` cannot be moved under the exception (installing certifi inside the sandbox already failed on the bundle write). Refused: setting `SSL_CERT_FILE`/`SSL_CERT_DIR` in project skills (the lexical guard blocks naming a `.pem` path, and a sandbox quirk would leak into project artifacts); allowing every `.pem` under dependency directories (libraries also ship test private keys).
**Why:** httpx builds its SSL context from `certifi.where()` when an `httpx.Client` is constructed, so a backend inside the project crashed on startup even without network calls. The project's `.venv` sits inside the root, where SBX-02's `.pem` deny applies.
**Revisit if:** another bundled trust store (botocore, grpc) blocks a real run.
**Evidence:** The user chose "certifi only".

### SBX-44 · Local service ports 5190 and 8020
`accepted` · 2026-11-05 · `01a1ab54-8686-73a0-886b-fc93ca6cb7d0`
**Decision:** Add 5190 and 8020 to the loopback ports confined commands may connect to. Refused: allowing every localhost port (reaches local daemons such as Paseo, Ollama and the egress proxy); moving the app onto already-allowed ports (may collide with a dev server already running there).
**Why:** health-claims runs its verification instance on 8020 (uvicorn) and 5190 (Vite), and Seatbelt refused connections to 8020 in a measured check.
**Revisit if:** per-project ports keep growing the list, which would justify a range or project configuration.
**Evidence:** The user chose "Add both ports".
