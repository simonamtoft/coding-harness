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
**Superseded by:** SUB-14.

### SUB-09 · The presenter never changed the parent's model
`rejected` · 2026-08-24 · `01a033ac`
**Decision:** Rejected changing presenter delegation to fix a reported parent-model switch. No change made.
**Why:** The timeline showed the parent switched models before dispatching the presenter, and live probes left both tested parent sessions unchanged.
**Revisit if:** A reproducible probe shows a presenter child mutating the parent session.

### SUB-10 · Subagent runs remain ephemeral
`accepted` · 2026-09-03 · `01a06634`
**Decision:** Keep `--no-session` on every subagent and reviewer subprocess. Surface child usage through the parent subagent tool result rather than retaining child session files.
**Why:** Persistent child sessions would help only with occasional forensic analysis. The parent already presents per-run and aggregate tokens and cost; persistence would not merge those provider calls into the parent session's native accounting, while it would accumulate disposable and potentially sensitive run histories.
**Revisit if:** Full child-run forensic inspection becomes a recurring operational need, or Pi gains supported parent-session cost aggregation.
**Evidence:** "I don't really care about resumable child-sessions"

### SUB-11 · Quick-commit analysis belongs to the cheap planner
`accepted` · 2026-09-03 · `01a06624`
**Decision:** The `commit-planner` alone reads the private working-tree snapshot and decides grouping, messages, and safety disposition; the parent only presents the result, obtains confirmation, and performs exact Git mutations.
**Why:** Having both the parent and planner read the diff duplicates large context in an expensive model without improving the commit plan. The parent retains the irreversible actions and user-facing safety gate.
**Revisit if:** Planner errors or unresolvable ambiguity make parent diff inspection necessary often enough to outweigh the context savings.
**Evidence:** "Let's now do the move to Luna"

### SUB-12 · Every subagent is owned by a skill and briefed once
`constraint` · 2026-09-08 · `01a08055`
**Decision:** A role must be dispatched by exactly one owning skill or by extension dispatch code; a role with no owner is deleted, not advertised. Its brief lives once as `<ROLE-NAME>.md` in the owning skill directory, and each harness agent file is native frontmatter plus a pointer to it. `documentation-analyst` was removed on this rule. Rejected: rendering discovered agents into the `subagent` tool description, registering one tool per role, pre-emptive intent routing, and a generator assembling shared bodies with per-harness frontmatter.
**Why:** Across 132 sessions every owned role was used and every orphan was not, although `swarm` already named all three orphans — so reachability follows from ownership, not from publishing an inventory. Routing would reintroduce the SUB-06 coordinator; a generator would add a build step, a staleness window, and generated artifacts to de-duplicate prose while leaving `tools` and `model` duplicated anyway.
**Revisit if:** A role needs two genuine owners, or a role earns its keep without any skill or machinery dispatching it.
**Evidence:** "Perhaps the best approach for now is simply having them linked directly from skills."

### SUB-13 · Claude counterparts are optional and unverified by Pi tests
`accepted` · 2026-09-08 · `01a08055`
**Decision:** `ownership.test.ts` asserts only about Pi: no orphaned agent, no skill naming an unknown role, every Pi pointer resolving. Parity is not required, no Claude capability assertion was added, and Claude stub paths and dispatch behavior are verified separately in PI-57.
**Why:** Claude declares `tools` without an enforcing validator, so a partial check in a Pi suite would suggest a write boundary it does not cover; `check-bash.sh` and `check-edit-scope.sh` remain the actual enforcement. `implementation-worker` cannot port at all, since Claude has no coordinator-provided worktree contract.
**Revisit if:** Claude gains agent-level tool enforcement, or a Claude stub is found running without its brief.
**Evidence:** "I will test claude at some other point"

### SUB-14 · Canonical subagent models use built-in providers by role
`accepted` · 2026-09-08 · `01a0825e`
**Decision:** Commit model pins for every canonical Pi role using only built-in `openai-codex` or `anthropic` providers. Use OpenAI Codex Luna for low-risk utility roles and Terra for implementation; use Anthropic Sonnet 5 for correctness review and Opus 4.8 for security review. Machine-local `subagents.json` retains higher precedence for provider, model, credentials, and cost policy.
**Why:** Custom `IM-GPT` is machine-wired and must not be a portable canonical dependency. Separating OpenAI Codex implementation from Anthropic review also gives correctness and security review an independent provider perspective.
**Revisit if:** Built-in provider availability, model quality, cost policy, or the desired implementation/review diversity changes.
**Evidence:** "I wanted to use default provider, as in openai-codex or anthropic, and not IM-GPT"
