# Backlog workflow

Decision ledger area. Entry ids use the `BKL-` prefix; see `../DECISIONS.md` for the format and append rules.

### BKL-01 · Backlog.md is the only tracker
`constraint` · 2026-08-24 · `01a033bc`, `01a033a0`
**Decision:** Backlog.md replaced FP. Do not carry FP commands or tracker assumptions into skills or workflows; migrate remaining references.
**Why:** Explicit user statement that the repository no longer uses FP.
**Revisit if:** Another task system is deliberately adopted.

### BKL-02 · Evaluation tickets are decision records, not authorization
`constraint` · 2026-08-24 · `01a033bc`, `01a033d4`
**Decision:** A spike or evaluation task must not modify skills or source. Implementation is a separate follow-up, created as each decision is finalized rather than batched at the end.
**Why:** Keeps evidence and decision separate from reviewable behavior change, while letting each ticket keep its own acceptance criteria.
**Revisit if:** An evaluation ticket explicitly authorizes implementation.

### BKL-03 · Group tasks by shared research, not shared decisions
`constraint` · 2026-08-24 · `01a033bc`, `01a03380`
**Decision:** Group tickets only when they share a decision surface, evidence base, or implementation boundary; each keeps an independent plan, acceptance criteria, and final state. The pstack evaluation was structured as one parent with 43 ordered subtasks.
**Why:** Grouping shares research; it must not merge decisions.

### BKL-04 · Cost-conscious Backlog discovery
`constraint` · 2026-08-25 · `01a03913`
**Decision:** Prefer `backlog task list --ready --sort priority --limit 10 --plain`, inspect only the selected task, avoid bulk view loops and broad JSON listings, and read only the relevant instruction guide.
**Why:** Reduces Backlog context and command cost without changing the global prompt.
**Superseded by:** BKL-07, which moved this guidance into `shared/AGENTS.md` and gated consultation itself rather than only making it cheaper.

### BKL-05 · Backlog decisions cannot hold this content
`rejected` · 2026-08-31 · `01a05899`
**Decision:** This ledger is a plain repository file rather than `backlog decision` entries or a `backlog doc`.
**Why:** `backlog decision` exposes only `create` and `list` — the Context/Decision/Consequences body can only be filled by editing the markdown directly, which the repository forbids. `backlog doc update --content` replaces the whole body, making append a read-modify-write. The cost is that entries are not in the Backlog search index.
**Revisit if:** Backlog adds a decision update or append command, in which case migrating these entries becomes worthwhile.

### BKL-06 · Worktree sessions count as real work
`constraint` · 2026-08-24 · `01a03380`
**Decision:** Include worktree-agent and feature-worktree sessions in usage audits and skill ranking rather than dismissing them as delegated subagent work.
**Why:** Substantial actual work happens there; excluding them undercounts workflow evidence.
**Revisit if:** An audit deliberately targets only primary interactive sessions.

### BKL-07 · Backlog consultation is trigger-gated, not per-request
`constraint` · 2026-09-03 · `01a06692-7a9e`
**Decision:** `shared/AGENTS.md` narrows the generated Backlog nudge: consult the tracker only when the request names a task or tracker state, a skill directs it, or tracked work is about to be created, planned, updated, or finalized. Skip `backlog instructions overview` entirely, read the lifecycle guide at the moment of acting, and read each guide at most once per session. Repository-authored guidance was moved out of the generated block, which `backlog agents --update-instructions` overwrites.
**Why:** Across 150 sessions, 215 overview calls and 171 guide calls produced 74 sessions that consulted no task at all, 20 of which still ran guides, and 12 calls discarded the guide to the null device. The generated nudge demands the overview "before answering", which is precisely when the need is unknowable; 23 sessions only discovered they needed a task after investigation.
**Revisit if:** Backlog makes the nudge configurable, in which case the gate belongs in the generated block itself.
**Partly superseded by:** BKL-09, which restored the overview as a once-per-session read; the trigger gate itself stands.
**Rejected alternatives:** Editing the generated block, which `backlog agents --update-instructions` overwrites; and per-skill "run no tracker command" rules, which would fix commit skills while leaving the 74 untracked free-form sessions untouched.
**Evidence:** "Too often the agent runs backlog commands such as `backlog instructions overview` even if the ask is pretty simple. E.g. when I run a commit skill, there is no reason to run that command."

### BKL-08 · Guide re-reads are refused at runtime, in Pi only
`accepted` · 2026-09-03 · `01a06692-7a9e`
**Decision:** `pi/agent/extensions/backlog-guard` blocks a repeat `backlog instructions <guide>` in the same session, forgets the ledger on compaction, and ignores instruction text inside quotes or heredoc bodies. No equivalent Claude hook was added.
**Why:** An instruction alone loses to the generated `<CRITICAL_INSTRUCTION>` block — that is how the ritual arose. In Claude, `backlog` is absent from the `check-bash.sh` readonly allowlist, so every call already surfaces as a permission prompt the user can refuse, and duplicating session state inside a stateless safety hook buys little.
**Revisit if:** Claude sessions show the same repeat pattern, or `backlog` is added to the Claude readonly allowlist.

### BKL-09 · The overview is kept, once per session
`reverted` · 2026-09-03 · `01a06692-7a9e`
**Decision:** Reverses BKL-07's instruction to skip `backlog instructions overview` entirely. Once a trigger puts the tracker in play, the overview is read once per session to establish the shape of the current work; the trigger gate and the one-read-per-session limit both stand, and `backlog-guard` already enforces the limit.
**Why:** The user's own framing: the overview is needed to understand the work in progress, but only when the turn works on project tasks and only once. Skipping it outright also lost the argument in practice — in a project whose `AGENTS.md` is nothing but the generated nudge, five of five observed sessions ran it anyway on the first turn.
**Revisit if:** The overview's content stops carrying project state and becomes purely a command index.
**Evidence:** "We do need the overview to understand the current work being done. But we only need it when working on project tasks, and only once in a session."

### BKL-10 · Upstream carries the conversation-scoped nudge from 1.51.0
`accepted` · 2026-09-03 · `01a06692-7a9e`
**Decision:** Updated the CLI to 1.51.0 and refreshed this repository's generated block. Upstream now says "At the beginning of each conversation ... Re-read it only if you have not read it yet in the current conversation", which independently matches BKL-07's per-conversation scope and BKL-08's no-re-read rule. Keep `backlog-guard` regardless: it enforces the no-re-read half deterministically.
**Why:** The local gate no longer has to fight the generated block on those two points, so future divergence is smaller. `backlog agents --update-instructions` is a `clack` multiselect; it can be driven non-interactively with `printf '\033[B \r' | backlog agents --update-instructions` for AGENTS.md, and it preserved all repository content outside the markers.
**Revisit if:** Upstream adopts the trigger-based condition, in which case section 5's narrowing clause can shrink further.

### BKL-11 · The remaining upstream gap is measured, not asserted
`accepted` · 2026-09-03 · `01a06692-7a9e`
**Decision:** Drafted an upstream issue and a local branch proposing that the overview read be gated on tracked work. Filed nothing: the user submits it.
**Why:** The 1.51.0 wording still mandates the overview at conversation start unconditionally, and a controlled probe showed `gpt-5.6-terra` reading it on 6 of 6 tracked-work-free conversations with the new nudge, 9 of 9 with the old one, and 0 of 6 with the nudge removed. `claude-haiku-4-5` read it 0 of 9 times under the same conditions, so the cost is model-dependent and the nudge is the cause.
**Revisit if:** Upstream declines the change, in which case removing the generated block per project becomes the only lever left.
