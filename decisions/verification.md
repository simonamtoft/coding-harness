# Verification loop

Decision ledger area. Entry ids use the `VER-` prefix; see `../DECISIONS.md` for the format and append rules.

`pi/agent/extensions/verify-turn`, `pi/agent/extensions/diagnostics`, `claude/hooks/verify-turn.sh`

### VER-01 · `.agent/verify.sh`, then Taskfile `verify`
`accepted` · 2026-08-24 · `01a0326c`
**Decision:** Both harnesses discover `.agent/verify.sh` first and fall back to a Taskfile `verify` task. The verifier lives in the target project, not in this repository.
**Why:** A neutral path avoids harness-specific configuration while matching projects that already use Taskfiles.
**Revisit if:** Projects need different precedence or a new repository-wide convention.

### VER-02 · Verification blocks the turn; `agent_settled` is not enough
`rejected` · 2026-08-24 · `01a03309`
**Decision:** Rejected running verification from `agent_settled`. Hold TUI focus with a cancellable `BorderedLoader` across discovery and execution.
**Why:** `agent_settled` fires after Pi re-enables input, so prompts and shell commands raced `task verify`. Escape remains available so a verifier trapping `SIGTERM` cannot lock the session.
**Revisit if:** Pi offers a lifecycle hook that blocks input before `agent_settled`.

### VER-03 · Never cancel a running verifier to unblock input
`reverted` · 2026-08-30 · `01a04ffd`
**Decision:** Reverted the proposed fix of cancelling an active verifier on new input. Let verification finish, then trigger one report-only turn.
**Why:** Cancellation would silently abort valid verification. The actual defect was presenting a clean report before verification completed.
**Revisit if:** Verification can be isolated from new user work without risking stale or competing processes.

### VER-04 · Terminate the verifier process group, not the child
`constraint` · 2026-08-24 · `01a0334a`
**Decision:** Automatic and focused verification runs must not overlap, and cancellation kills the whole process group.
**Why:** `task verify` spawns Playwright and Next descendants that survive direct-child termination and starve later checks. The same lesson recurred for worktree dev servers (`01a0386d`): killing Next's child PID does not release the port.
**Revisit if:** Verifier execution gains external process-tree lifecycle management.

### VER-05 · Spawn failures are verification failures, not lifecycle errors
`reverted` · 2026-08-24 · `01a0334a`
**Decision:** An OS-level spawn error must not reject out of the lifecycle hook; convert it into a captured nonzero result feeding normal repair.
**Why:** Rejecting bypassed the standard failure path, so the agent never received repair feedback.
**Revisit if:** Launch failures are deliberately made fatal.

### VER-06 · Trigger on content change, not on turn completion
`accepted` · 2026-08-25 · `01a037c3`, `01a038d1`, `01a03378`
**Decision:** Verify only when project content changed. Skip turns where every changed file is Markdown (mixed changes still verify), and skip turns whose assistant message has `stopReason: "aborted"`. Unknown snapshot states verify conservatively.
**Why:** Content fingerprinting separates read-only and commit-only turns from real edits; verifying cancelled output was over-aggressive.
**Revisit if:** The verifier must react to metadata, environment, or dependency state, or Markdown gains executable effect.

### VER-07 · Rediscover the verifier every applicable turn
`accepted` · 2026-08-24 · `01a0335c`
**Decision:** Do not cache verifier discovery for the session.
**Why:** `wire-up-verifier` can create `.agent/verify.sh` mid-session; caching would hide it for the rest of that session.
**Revisit if:** Verifier configuration becomes immutable per session.

### VER-08 · Agents run targeted checks, the loop runs the full verifier
`accepted` · 2026-08-24 · `01a0335c`
**Decision:** During implementation, run focused checks only; leave `task verify` to the automatic loop.
**Why:** Prevents redundant full runs while preserving fast feedback.
**Revisit if:** Automatic verification is unavailable or insufficient for the change.

### VER-09 · After the verification handoff, do not touch files
`constraint` · 2026-08-24 · `01a0336c`
**Decision:** When the handoff says verification passed and asks for the definitive final response, respond without file edits or tool calls.
**Why:** The handoff represents completed, verified work.
**Revisit if:** The user requests a new change in that turn.

### VER-10 · Keep `wire-up-verifier` generic and end-of-turn only
`rejected` · 2026-08-26, 2026-08-30 · `01a03d21`, `01a05449`
**Decision:** The skill must not prescribe Playwright reporter flags, and was refused as the owner of per-edit hooks. It scaffolds only the single authoritative end-of-turn verifier; `verify-turn` discovers it automatically.
**Why:** Reporter choice is project-specific, and per-edit verification needs fast language-specific checks plus policies for transient errors, cancellation, and duplicate diagnostics.
**Revisit if:** A stable cross-language after-edit contract can be defined without turning project scaffolding into extension design.

### VER-11 · After-edit diagnostics are advisory and project-owned
`accepted` · 2026-08-30 · `01a05449`
**Decision:** A language-agnostic extension invokes an optional executable `.agent/diagnostics.sh` with changed paths. Diagnostics inform; `.agent/verify.sh` remains the blocking gate.
**Why:** The project chooses its own fast checks; the extension invents no language detection or tool policy.
**Revisit if:** Diagnostics need debouncing, coalescing, or a richer manifest.
