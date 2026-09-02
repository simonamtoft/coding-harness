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
