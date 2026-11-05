# Extensions and repository layout

Decision ledger area. Entry ids use the `EXT-` prefix; see `../DECISIONS.md` for the format and append rules.

### EXT-01 · No test files in the extension root
`constraint` · 2026-08-26 · `01a03d04`, `01a03939`
**Decision:** Pi auto-loads every root `*.ts` in `pi/agent/extensions/` and requires a default factory export. Colocate tests and helper modules inside extension subdirectories, where only `index.ts` is discovered.
**Why:** A Bun-only test importing `bun:test` is loaded by Node/Jiti at startup and prevents Pi from launching; a named-export helper in the root fails the factory contract.
**Revisit if:** Pi changes root discovery or supports exclusions.

### EXT-02 · Edits through `~/.pi/...` are repository edits
`accepted` · 2026-08-25 · `01a03939`
**Decision:** `~/.pi/agent/extensions` is a symlink into this repository; treat changes made there as version-controlled changes here.
**Why:** The symlink keeps Pi's runtime path while sources stay canonical.
**Revisit if:** Link topology changes or runtime files must stay local.

### EXT-03 · Install Pi packages from git specs via `link.sh --packages`
`rejected` · 2026-08-20 · `01a01f5f`
**Decision:** Rejected cloning and pulling plugin repositories into a repository-managed directory. Specs live in `pi/agent/packages.txt` and install through an explicit `--packages` step; local paths are documented as the development-time override.
**Why:** Pi already installs reproducibly from GitHub, and package installation mutates local runtime state, so it stays out of the normal link operation.
**Revisit if:** Pi drops the git package source format.

### EXT-04 · Self-owned packages stay unpinned
`accepted` · 2026-08-26 · `01a03f74`
**Decision:** Git package references the user owns and maintains are left unpinned; the supply-chain risk is accepted knowingly.
**Why:** Explicit user judgment about trust in their own packages.
**Revisit if:** Ownership changes or reproducible supply-chain protection becomes a requirement.

### EXT-05 · MCP adapter disabled, configuration retained
`constraint` · 2026-08-20 · `01a01f5f`
**Decision:** `npm:pi-mcp-adapter` removed from the live install and left disabled in the manifest; `pi/agent/mcp.json` stays linked.
**Why:** The config is inert without the adapter but still holds the user's server definitions.
**Revisit if:** MCP is used again.

### EXT-06 · Claude theme wrapper writes through the symlink
`constraint` · 2026-08-24 · `01a0326c`
**Decision:** Keep `theme` in tracked `settings.json` and have the wrapper use `cat "$tmp" > "$settings"` rather than `mv`.
**Why:** Replacing the file breaks the symlink, silently decoupling settings from version control and making later non-force linking refuse. A dirty tree on launch is the accepted cost.
**Revisit if:** Theme selection moves out of the tracked settings file.

### EXT-07 · Worktree cleanup belongs to the plugin
`rejected` · 2026-08-25 · `01a0387a`, `01a0386d`
**Decision:** Rejected the standalone cleanup script; cleanup runs on Pi shutdown and before worktree removal, inside the plugin. Removal refuses tracked uncommitted changes, cleans build artifacts, and confirms other untracked files.
**Why:** Cleanup was expected to be part of existing worktree automation, and removal must not destroy unmerged work.
**Revisit if:** The plugin cannot own worktree lifecycle, or an explicitly confirmed destructive mode is added.
**Evidence:** "if we're tring to remove a worktree that isn't merge and has leftover work not comitted, then it should not be allowed."
**Superseded by:** EXT-12 on the `paseo-trial` branch.

### EXT-08 · Worktree browser access is origin-scoped
`constraint` · 2026-08-26 · `01a03f74`
**Decision:** The browser tool may reach only the exact `localhost:<port>` assigned to that worktree.
**Why:** Chosen over general local browser access.
**Revisit if:** Worktree applications need multiple local origins.

### EXT-09 · Bash results are cut to 16 KB and re-spilled to a private artifact
`accepted` · 2026-09-08 · `01a08143`, `01a0810b`
**Decision:** `bash-result-limiter` replaces every oversized bash result with a 16 KB tail, well below Pi's own 50 KB default, and copies the full output into a mode-0600 file in `PI_SESSION_TMPDIR` instead of pointing at Pi's spilled file. Both the model-facing marker and the result's `details.fullOutputPath` name that copy; Pi's original spilled file is left in place. The limiter does its own byte-bounded, line-aligned tail rather than calling the package's `truncateTail`.
**Why:** 16 KB comes from observed session behaviour, not from a formula. Pi writes spilled output through `createWriteStream` into the shared `os.tmpdir()` with default permissions, so the copy is the privacy boundary; deleting Pi's original is unsafe because Pi still references it. `truncateTail` is unresolvable under `bun test` in this repository, so depending on it forces either an injected seam with a diverging test double or an untested code path.
**Revisit if:** Pi spills output with restrictive permissions or into the session directory, the retained size stops matching how sessions actually consume bash output, or the repository gains a resolvable dependency on the Pi package in tests.

### EXT-10 · Read routing gates on 16 KiB of bytes, not 350 lines
`accepted` · 2026-09-12 · `01a09613`
**Decision:** `read-routing` and `route-bulk-read.py` route a broad read when the resolved regular file is larger than 16 KiB. The 350-line threshold and the 256 KiB backstop are removed, along with all line scanning; the guards now only stat the file. The bounded-read allowance stays at `limit` 1–350 even though it no longer follows from the gate, so a blocked file of at most 350 lines can still be pulled whole by one bounded read. Reinstating a byte gate reverses the earlier removal of the 16 KiB gate, and re-routes the 348-line article that motivated that removal.
**Why:** Measured A/B runs put delegation overhead near-fixed at $0.010–$0.014 and single-pass break-even at 9.5 KiB (Opus), 13 KiB (Sonnet 4.6) and 18 KiB (Terra/Sonnet 5); 16 KiB clears break-even for the parent models in normal use. Characters per token held near 3.6 across prose and code while tokens per line varied fourfold, so bytes track cost and lines do not: the line rule delegated 350-line code files worth ~3,400 tokens while ignoring 150-line prose files worth ~5,900. The earlier removal was made without cost evidence. Tightening the bounded-read allowance to make the gate unevadable was rejected: one extra read turn costs $0.013–$0.053 on Opus, more than the $0.0136 delegation it would replace, so the cost falls on legitimate source inspection while the skill's no-evasion rule already covers the abuse case.
**Revisit if:** the usual parent model moves to a cheaper tier, where break-even rises above 16 KiB; worker or parent pricing shifts materially; or session evidence shows the bounded-read allowance being used routinely to page whole gated files.

### EXT-11 · Post-worker rereads are answered with a result footer, not a block
`accepted` · 2026-09-16 · `01a0ab6e`
**Decision:** `read-routing` keeps per-session bulk-reader state — files the worker actually read (its `read` calls in the subagent result) and whether the latest dispatch failed — and uses it in two instruction surfaces only: a footer appended to every `bulk-reader` subagent result naming the covered files, telling the parent to cite the worker's path/line ranges as observed, to dispatch `bulk-reader` again for a further factual question, and to read only the smallest section for one specific claim; and block wording that says "already read by bulk-reader" for covered files or "do not redispatch" after a failure instead of pointing back at a dead worker. Bounded reads still pass unchanged. A cumulative per-file allowance that would block paging of covered files was considered and deferred; "make the block message stronger" was rejected as the lever.
**Why:** Session `01a0ab2f-cf9a-7188-8759-8eb5e49dfbd6` showed a successful worker (6.6 KB answer) followed by the parent sizing reads with `wc -l` and re-reading ~1,800 lines of the same files in ≤350-line pages: no block ever fired, so block wording could not have changed it. Session `01a0ab20-41d0-72b9-a60f-cde869d2ccf2` showed the opposite path: the worker failed (local `PrivateGPT` 401) and the block message kept recommending it. The parent's stated reason to reread was citation form (`explain-code` demanded `path:line`, `bulk-read` called worker line numbers non-authoritative), so the skill contracts now accept observed line ranges. Instruction at the decision point with exact file names is tried before enforcement because a block on covered files also taxes legitimate inspect reads (EXT-10 cost argument); the footer's file set is the state such a block would need if trials show paging continues. This narrows SUB-15's "no per-read exemption state or session toggle": the state here never exempts or grants a read.
**Revisit if:** natural-session trials after this change still show the parent paging worker-covered files, in which case add the cumulative allowance block using the recorded coverage; or if the footer measurably suppresses legitimate inspect reads.

### EXT-12 · Paseo trial: Paseo owns worktrees; its orchestration skills stay out
`accepted` · 2026-10-21 · `01a15834`
**Decision:** On the `paseo-trial` branch, Paseo workspaces own worktree creation and cleanup, and `pi-worktree-agents` is removed from `pi/agent/packages.txt`. With the plugin gone, its `/wt` commands, cleanup guard (EXT-07), and per-worktree browser origin (EXT-08) are unavailable once it is uninstalled. `swarm` accepts a Paseo workspace as a writable worker's pre-created worktree; SUB-06 is unchanged, because the parent and workers still never create, merge, or remove worktrees. Paseo's orchestration skills are not installed, and its agent-spawning tools are not part of the harness workflow. `verify-turn` notifies on start and pass outside the TUI. Rejected for now: treating Paseo worktrees of this repository as coding-harness sessions in the sandbox, and guarding `shared/skills` with a load-check failure or gitignore entries.
**Why:** Paseo drives Pi over `pi --mode rpc` and already manages worktree lifecycle, so two owners would conflict. Paseo's skill installer writes to both the Claude skills directory (the `shared/skills` link) and the Agent Skills user directory, which would add untracked files here and load each skill twice in Pi; the user does not plan to install them. RPC clients show `notify` but not `setStatus` or the TUI panel. Widening the sandbox's harness-session rule to Paseo paths is a trust-boundary change that the trial does not need.
**Revisit if:** The trial ends (merge into main or drop the branch); Paseo removes worktrees that hold uncommitted work; Paseo's orchestration skills become wanted; or editing the harness from Paseo worktrees becomes a recurring need.
**Evidence:** User chose "In the main checkout", all four alignment items, branch "paseo-trial", and "Remove from manifest"; "I assume I wont be installing any Paseo skills."

### EXT-13 · Paseo: track config.json only, linked into ~/.paseo
`accepted` · 2026-10-21 · `01a15dee`
**Decision:** On `paseo-trial`, `paseo/config.json` is canonical and `link.sh` links `~/.paseo/config.json` to it. Rejected: a repository `paseo/` symlink pointing at `~/.paseo`. Secrets are checked per diff rather than enforced by a hook or by splitting the file.
**Why:** The reverse link would version nothing and would bring Paseo runtime state (worktrees, logs, hub credentials, sessions) into the checkout, against the local-state rule. Paseo's `writePrivateFileAtomicSync` resolves the symlink before renaming, so its own config writes keep the link and land in the tracked file. The current file has no secrets; the user preferred reviewing diffs over keeping auth and provider keys out by construction.
**Revisit if:** Paseo starts replacing the symlink on write, a secret is committed, or other `~/.paseo` files become worth versioning.
**Evidence:** User chose "Track config.json only", "Check case by case", and branch "paseo-trial".

### EXT-14 · Paseo commits go through quick-commit, typed in chat
`rejected` · 2026-10-21 · `01a15dee`
**Decision:** In Paseo, commit by typing `/skill:quick-commit` in a Pi chat. Rejected: a Paseo plugin header button that sends the skill command, and patching the Paseo app bundle to redirect the built-in Commit button.
**Why:** Paseo 0.12 hardcodes the Commit action (`git/policy.ts`), which runs `git add -A` and commits a generated message without review, and offers no config or plugin API to hide or redirect it. A plugin could only add a second button, costing unsandboxed plugin code for a command Paseo already autocompletes from Pi's command list. A bundle patch is lost on every Paseo update.
**Revisit if:** Paseo exposes a way to override or hide built-in git actions, or typing the command becomes a recurring burden.
**Evidence:** User chose "Just type it".

### EXT-15 · Worktree load checks use an overlay agent directory
`accepted` · 2026-10-21 · `01a15f5e`
**Decision:** In a linked worktree, `scripts/pi-load-check.ts` starts Pi with `PI_CODING_AGENT_DIR` set to a temporary overlay: repository-owned entries link to the worktree, all other entries link to the real agent directory. The overlay is a sibling of the agent directory. The main checkout keeps the check that `~/.pi` links to it. Rejected: skipping the check with a warning in worktrees, always using the overlay, running `link.sh` from a worktree, and committing with `--no-verify`.
**Why:** Paseo commits from worktrees whose `~/.pi` links point at the main checkout, so the hook always failed there, and a merge into main does not run pre-commit. A skip would let unchecked runtime changes reach main. Always using the overlay drops the check that the real install is linked. Pi resolves local package paths in `settings.json` relative to the agent directory, so an overlay under `$TMPDIR` lost the `../../pi-plugins/...` package.
**Revisit if:** Worktree changes to `packages.txt` need load checking, Pi stops honouring `PI_CODING_AGENT_DIR`, or the Paseo trial ends without worktree commits.
**Evidence:** User chose "Overlay in worktrees".

### EXT-16 · Papercuts are self-reported through a Pi tool into one untracked file
`accepted` · 2026-11-04 · `01a1a763`
**Decision:** The `papercuts` extension registers `report_papercut`, which appends entries to `PAPERCUTS.md` at the canonical checkout root, resolved through the extensions symlink, from every project's Pi session. The file is gitignored. Rejected: a `shared/AGENTS.md` rule telling agents to edit a per-repository `PAPERCUTS.md`; mining transcripts for denials and retries at review time, alone or alongside the tool; committing the file; and Claude support.
**Why:** An always-loaded instruction bullet costs every session for a rare action (compare OWN-08), and a per-repository file would scatter notes into client repositories; the sandbox also blocks those sessions from writing a central file. A tool writes in-process, past the sandbox, and fills in cwd and session id itself. Transcript mining misses friction only the agent notices, such as unclear instructions or missing skills. Entries name local and client projects, so the file stays local. Claude has no extension mechanism to reuse.
**Revisit if:** Entries are mostly noise or agents rarely call the tool; the review needs evidence that self-reports miss, such as denial counts; or Claude sessions become a significant source of friction.
**Evidence:** User chose "Agent tool", "Repo root, untracked", and "Pi only".
