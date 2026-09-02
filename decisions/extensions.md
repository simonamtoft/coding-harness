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
