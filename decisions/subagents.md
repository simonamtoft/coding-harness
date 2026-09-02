# Subagents and review

Decision ledger area. Entry ids use the `SUB-` prefix; see `../DECISIONS.md` for the format and append rules.

### SUB-01 · Independent review is proportional to risk
`accepted` · 2026-08-24 · `01a033aa`
**Decision:** Correctness review by default; security review only for security-relevant changes or explicit `/review`; no review for trivial, documentation-only, or Backlog-only changes. A separate explorer stage before correctness was rejected as duplicate work.
**Why:** Running parallel correctness and security reviewers on every change, including ticket creation, was too aggressive.
**Revisit if:** Change classification proves unreliable or policy requires universal security review.

### SUB-02 · Defer autonomous review until verification passes; run explicit reviews immediately
`accepted` · 2026-08-25 · `01a03913`
**Decision:** An autonomous review requested during implementation is held while a verifier is active and released once, preserving `base`, `focus`, and `security`. An explicit `/review` is never deferred.
**Why:** Failed verification must be repaired before review, and review-driven fixes must not loop; an explicit review turn should not be forced through another verification pass.
**Revisit if:** Review and verification become independently scheduled.

### SUB-03 · Carry the implementation report through review
`accepted` · 2026-08-24 · `01a032be`
**Decision:** The final response after review restates the implementation summary and prior verification, then adds review findings and fixes.
**Why:** The model was answering only the reviewer's concerns while its implementation report sat in an earlier message.
**Revisit if:** The flow starts producing duplicated or conflicting summaries.
**Evidence:** "Somehow we need to carry that forward."

### SUB-04 · Review bundles live inside the session workspace
`accepted` · 2026-08-24 · `01a032be`
**Decision:** Create bundles in the active session directory, exclude each bundle from its own snapshot, remove it afterward.
**Why:** Headless reviewer subprocesses deny reads outside the repository, so OS-temp bundles were unreadable.
**Revisit if:** Reviewer subprocesses gain a supported mechanism for external temporary files.

### SUB-05 · Unknown subagent names fall back generically
`accepted` · 2026-08-24 · `01a033d6`
**Decision:** Resolve unknown agent names to a generic fallback inheriting the parent model and default tools, instead of maintaining alias files. Shared instructions are not passed explicitly, because `~/.pi/agent/AGENTS.md` is the symlinked `shared/AGENTS.md` Pi already loads.
**Why:** Models are rotated across Claude, GPT, and Qwen, so model-specific aliases would never stay complete.
**Revisit if:** Pi adds native fallback, or unknown names should fail loudly to catch typos.

### SUB-06 · Parent-owned orchestration; no coordinator, registry, or engine
`constraint` · 2026-08-25 · `01a03969`, `01a03974`
**Decision:** The parent owns framing, resources, aggregation, judging, and reporting. No separate coordinator, race judge, registry, workflow engine, scheduler, or generic fallback worker. Writable workers receive pre-created worktrees and may not create, merge, or remove them; `/wt-new-agent` was deferred to PI-15.
**Why:** A coordinator loses the parent's task context and duplicates its judgment; automating worktrees introduces naming, collision, cleanup, merge-ownership, and allocation decisions.
**Revisit if:** Preparing worktrees manually becomes a recurring burden, or a workflow needs coordinated multi-writer execution.

### SUB-07 · Document subagent contracts instead of building a registry
`accepted` · 2026-08-25 · `01a03958`
**Decision:** Harden and document discovery, trust, capability, fallback, and reviewer contracts; do not duplicate the agent inventory in documentation.
**Why:** Runtime discovery already loads user and project agents; a second inventory drifts.
**Revisit if:** Runtime enforcement requires a registry.

### SUB-08 · Presenter model is machine-local
`accepted` · 2026-08-22 · `01a0288b`, `01a03959`
**Decision:** Agent definitions are committed, but provider/model mappings live in the untracked `~/.pi/agent/subagents.json`.
**Why:** Provider names, model ids, credentials, cost policy, and availability vary per machine.
**Revisit if:** A portable model-configuration format with per-machine overrides exists.

### SUB-09 · The presenter never changed the parent's model
`rejected` · 2026-08-24 · `01a033ac`
**Decision:** Rejected changing presenter delegation to fix a reported parent-model switch. No change made.
**Why:** The timeline showed the parent switched models before dispatching the presenter, and live probes left both tested parent sessions unchanged.
**Revisit if:** A reproducible probe shows a presenter child mutating the parent session.
