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
