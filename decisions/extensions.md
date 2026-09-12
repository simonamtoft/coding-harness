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
