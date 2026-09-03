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
**Rejected alternatives:** Editing the generated block, which `backlog agents --update-instructions` overwrites; and per-skill "run no tracker command" rules, which would fix commit skills while leaving the 74 untracked free-form sessions untouched.
**Evidence:** "Too often the agent runs backlog commands such as `backlog instructions overview` even if the ask is pretty simple. E.g. when I run a commit skill, there is no reason to run that command."

### BKL-08 · Guide re-reads are refused at runtime, in Pi only
`accepted` · 2026-09-03 · `01a06692-7a9e`
**Decision:** `pi/agent/extensions/backlog-guard` blocks a repeat `backlog instructions <guide>` in the same session, forgets the ledger on compaction, and ignores instruction text inside quotes or heredoc bodies. No equivalent Claude hook was added.
**Why:** An instruction alone loses to the generated `<CRITICAL_INSTRUCTION>` block — that is how the ritual arose. In Claude, `backlog` is absent from the `check-bash.sh` readonly allowlist, so every call already surfaces as a permission prompt the user can refuse, and duplicating session state inside a stateless safety hook buys little.
**Revisit if:** Claude sessions show the same repeat pattern, or `backlog` is added to the Claude readonly allowlist.
