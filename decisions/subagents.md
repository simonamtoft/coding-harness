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
**Why:** Custom `PrivateGPT` is machine-wired and must not be a portable canonical dependency. Separating OpenAI Codex implementation from Anthropic review also gives correctness and security review an independent provider perspective.
**Revisit if:** Built-in provider availability, model quality, cost policy, or the desired implementation/review diversity changes.
**Evidence:** "I wanted to use default provider, as in openai-codex or anthropic, and not [PrivateGPT]"

### SUB-15 · Bulk-read hooks redirect; the parent frames extraction
`accepted` · 2026-09-12 · `01a0950d`
**Decision:** Use native cost hooks and one shared bulk-read workflow, not Portal or a hook-spawned model. The parent supplies the extraction question; ordinary read-only workers return evidence, not correctness judgments. Claude uses Haiku. Pi retains its configured utility model only within the active parent's provider and otherwise inherits the parent's exact model; this provider boundary is enforced at dispatch, including over local `subagents.json` overrides. Direct full-source access uses bounded reads only: no per-read exemption state or new session toggle. Delegated writing and shell-read interception remain out of scope.
**Why:** A read call supplies a path but not the question the parent needs answered. Native delegation already owns model selection and isolation. A read-only child sends source contents to its model provider, so instructions and machine-local pins cannot safely act as the cross-provider egress boundary. The user chose bounded reads over exemption machinery and Haiku over the existing Claude Sonnet utility convention. This is an explicitly requested pilot, not a claim of measured savings or a speculative skill inferred from session frequency.
**Revisit if:** Representative tasks show repeated routing friction, unreliable extraction, or combined worker/parent cost and latency outweighing context savings.
**Evidence:** "Haiku"; "Bounded reads only".
**Superseded by:** SUB-16.

### SUB-16 · Provider pins are predictable routing, not an egress boundary
`accepted` · 2026-09-12 · `01a0952a`
**Decision:** Every Pi child receives explicit `--provider` and `--model` arguments. A canonical or `subagents.json` pin is honored independently of its parent for all delegation modes, including reviews; only an unpinned agent inherits the parent's exact provider/model and thinking level. Remove bulk-reader's same-provider restriction. Missing, malformed, or unavailable selections fail clearly and never fall back to another provider.
**Why:** Parent-provider affinity unexpectedly discarded valid local configuration and conflated deterministic model routing with a data-egress control. Explicit provider/model arguments prevent Pi's fuzzy resolution from silently crossing providers while leaving data-provider authorization to the applicable project policy.
**Revisit if:** Pi provides an authoritative availability preflight or a separately specified data-egress policy requires enforced provider boundaries.
**Evidence:** "Implement predictable provider selection for all Pi subagent delegation."

### SUB-17 · Bulk reads route by file lines, not bytes
`reverted` · 2026-09-12 · `01a095e5`
**Decision:** Replace the 16 KiB broad-read threshold in both Pi and Claude with file length strictly greater than 350 lines. Preserve direct bounded requests, governing/native-document exemptions, and independent sandbox checks. Count lines with fixed-memory scans rather than loading entire files; the Bash output limiter retains its separate byte budget.
**Why:** The user rejected the byte gate as an inappropriate carryover from output limiting. In session `01a095f7-595a-7565-93d3-875f5ab66d78`, a converted article was only 348 lines but 23,723 bytes: it triggered a worker round trip despite fitting the direct line allowance. The worker could not read the parent's temporary artifact, so the parent then read it in one bounded call. The sandbox boundary was not changed to compensate for a threshold mismatch.
**Revisit if:** Representative line-based trials show that long individual lines or scan latency outweigh the simplicity of the line-only policy.
**Evidence:** "I think we should just keep it at the line # reads, and not the 16KiB if-statement." Follow-up choices: "File line count"; "Both Pi and Claude".
**Superseded by:** SUB-18.

### SUB-18 · Long-line scan backstop also triggers delegation
`accepted` · 2026-09-12 · `01a095e5`
**Decision:** Route broad reads exceeding 350 file lines OR 256 KiB in both harnesses, retaining bounded-read and document exemptions. Use file size to route already oversized files and cap scanning at the byte threshold plus one overflow-probe byte for files that grow during inspection. Do not treat scan-budget exhaustion as permission to read directly or claim it proves a line count.
**Why:** Independent review identified unbounded I/O for huge files with few newlines. The user chose to route those byte-heavy reads rather than defer them to the native tool. A 256 KiB backstop bounds scanner work while leaving the observed 348-line, 23,723-byte article direct; it is separate from the Bash output limiter's 16 KiB budget.
**Revisit if:** Representative extraction trials show that the byte backstop adds unnecessary delegation or misses economically useful routing opportunities.
**Evidence:** "treat the byte gate similar to line gate"; selected "350 lines or 256 KiB".

### SUB-19 · Canonical agents pin their thinking level
`accepted` · 2026-09-23 · `01a0cf09`
**Decision:** Every canonical Pi agent declares `thinking:` in its frontmatter: `bulk-reader` stays `low`, all others use `medium`. Pinned agents no longer depend on the machine-local `defaultThinkingLevel`.
**Why:** A pinned child without `thinking:` receives the untracked local default, and provider defaults drift across model versions (Opus 5 defaulted to `high` effort, Opus 5.5 to `medium`, and Pi's managed-effort path falls back to `high`). Anthropic's Opus 5.5 guidance is to start at `medium` and re-tune rather than carry settings over. Declaring the level keeps review and worker behavior reproducible across machines and model upgrades.
**Revisit if:** A model upgrade or probe comparison shows a role needs a different level, or `subagents.json` gains per-agent thinking overrides.
**Evidence:** "YEs add thinking medium"; "Put medium to these as well."

### SUB-20 · Keep Luna for `bulk-reader` after Haiku 5.5 trials
`rejected` · 2026-10-08 · `01a11ad2`
**Decision:** Do not switch the canonical `bulk-reader` pin from `openai-codex/gpt-6-luna` to `anthropic/claude-haiku-5-5`. The other four Luna roles were not evaluated and keep their pins.
**Why:** In 80 worker-only runs Haiku gave far more source-bound citations but cost about 2.6× more at the worker. In a 12-run parent-workflow smoke (3 pairs × 2 tasks), all final answers were correct on both arms, combined cost was within about 2%, and Haiku was about 25% slower; the worker's citation advantage was largely absorbed by parent re-reads. Evidence is small, uses one parent model, and the Luna arm ran on `PrivateGPT` after an `openai-codex` login expiry.
**Revisit if:** Long-source tasks show parent re-reads dominating combined cost, citation precision becomes worth the extra cost and latency, or pricing changes.
**Evidence:** "Seems like a more capable model then"; user chose the slim trial and PrivateGPT Luna when auth expired. Details: `probes/reader-compare/REPORT.md`.

### SUB-21 · OpenAI-family roles pin the `PrivateGPT` provider alias
`accepted` · 2026-10-11 · `01a11ad2`
**Decision:** The six canonical roles that pinned `openai-codex` (`bulk-reader`, `commit-planner`, `presenter`, `repository-scout`, `test-log-analyst`, `implementation-worker`) pin `PrivateGPT/gpt-6-luna` or `gpt-6-sol` instead. `PrivateGPT` is a neutral name for the team's private OpenAI-family provider (formerly named differently locally); models and tiers are unchanged. Anthropic reviewers keep their pins. This partly reverses SUB-14's rule that committed pins use only built-in providers.
**Why:** The team routes OpenAI-family traffic through the private provider. A neutral alias avoids committing the internal provider name, but it is not a security control. Each machine must define a `PrivateGPT` provider in its untracked `models.json`; otherwise dispatch fails clearly (SUB-16) and a local `subagents.json` override is needed. Reviewers stay on Anthropic to keep their independence from the implementer.
**Revisit if:** Another machine needs a different provider name, the alias hides a real misconfiguration, or `PrivateGPT` gains Claude models.
**Evidence:** "We need to swap everything to [PrivateGPT] instead of openai-codex"; user chose a committed neutral alias and to keep Anthropic where it is.

### SUB-22 · No routed write delegation for small boilerplate
`rejected` · 2026-10-12 · `01a12f05`
**Decision:** Do not add implementation routing, the write-side counterpart of read-routing, for bounded boilerplate of up to about 100 lines under an Opus parent: tests from parent-specified cases, fixtures, or scaffolding that follows a pattern. The parent should write such slices directly. The existing `swarm` + `implementation-worker` path stays as it is for explicit delegation, and no production change follows. Delegation of large mechanical batches is deferred, not rejected. Prefer a deterministic generator or codemod for those before a worker. PI-15 stays deferred, because nothing here shows that multiple writers pay off.
**Why:** PI-63 ran 8 headless trials (4 tasks, direct vs delegated, Opus 5.5 parent, `PrivateGPT/gpt-6-sol` worker). Every artifact passed its check, quality was equivalent in each pair, and no rework was needed. Even so, the delegated runs cost $1.41 against $0.81 in total and took 2.75× the wall time. In every task the delegated parent's cost alone was higher than the whole direct run. Parent output went up, not down (16.3k against 14.1k tokens), because writing the brief, managing the worktree, and reviewing the full diff cost more than writing 50–80 lines directly. Extra turns (11 against 6) drove the overhead through cache reads. Sandbox friction around session-temp worktrees added roughly three blocked calls per run. Spotify's output savings assume generated volume this work does not have.
**Revisit if:** a measured large mechanical batch (hundreds of lines per brief) shows parent output savings above the roughly $0.13–0.18 fixed overhead per delegation; the usual parent model gets much more expensive per output token; or worktree setup and review become materially cheaper.
