# Skill boundaries

Decision ledger area. Entry ids use the `SKL-` prefix; see `../DECISIONS.md` for the format and append rules.

### SKL-01 · Automatic skill discovery stays enabled
`constraint` · 2026-08-25 · `01a03913`
**Decision:** Do not add `disable-model-invocation` broadly to save context.
**Why:** The expected savings were too small to justify losing automatic discovery. Individual user-triggered workflows (`simplify-skill`, `analyze-sessions`) still opt out deliberately.
**Revisit if:** Measured invocation cost outweighs the loss of discovery.

### SKL-02 · Weaker models need explicit `/skill:<name>` invocation
`accepted` · 2026-08-24 · `01a03429`
**Decision:** When a model does not load a matching skill from natural language, invoke it explicitly.
**Why:** A Qwen session never issued the full `SKILL.md` read; Pi documents that matching does not guarantee loading.
**Revisit if:** The model reliably performs progressive disclosure.

### SKL-03 · Shared means harness-neutral; only delegation differs
`accepted` · 2026-08-24, 2026-08-30 · `01a0326c`, `01a05451`, `01a037e5`
**Decision:** Keep one shared implementation and vary only the harness-specific call — one `present` pipeline with Pi `subagent` and Claude `Task` delegation documented separately; one `visual-verification` skill holding managed-Chromium capture, with ports and selectors left to project instructions. Shared skills resolve helper scripts relative to their own installed directory, never through `~/.claude/...`.
**Why:** The machinery is harness-neutral; duplicating it causes drift, and absolute Claude paths break under Pi.
**Revisit if:** The harnesses require materially different machinery, not just different delegation syntax.

### SKL-04 · No Pi-only tool calls inside shared skills
`reverted` · 2026-08-26 · `01a03d0e`
**Decision:** Removed the instruction to call Pi's `review_changes` from the shared `blast-radius` skill, keeping harness-neutral guidance for composing an independent review.
**Why:** `review_changes` does not exist in Claude Code, so the shared skill would fail there.
**Revisit if:** Both harnesses expose a compatible review interface.

### SKL-05 · Keep skills separate when they answer different questions
`accepted` · 2026-08-25, 2026-08-28 · `01a047e6`, `01a03a82`, `01a03a8d`
**Decision:** `domain-modeling` and `technical-design` stay separate — domain modeling resolves concepts, vocabulary, scenarios, and invariants before technical contracts and boundaries; CONTEXT files stay glossary-only; detailed API and module design stays in the design workflow. `technical-writing` stays bounded against `humanize-writing` and `to-spec`. The design skill was renamed from `architecture-design` because its deliverable is a narrow artifact, not system-architecture governance.
**Why:** Merging would blur the rule that domain context excludes implementation detail and make design depend unnecessarily on domain modeling.
**Revisit if:** Triggers or outputs materially overlap.

### SKL-06 · Consolidate when modes share one contract
`accepted` · 2026-08-25, 2026-08-30 · `01a038a6`, `01a047b0`, `01a05434`
**Decision:** One read-only `explain-code` skill with how/why/change modes rather than separate skills; one `analyze-sessions` dispatcher with explicit workflows, initially preserving existing behavior. The change-explanation workflow reuses the existing presenter and HTML pipeline instead of importing the upstream Notion variant.
**Why:** Shared lifecycle, output, and safety contracts make one skill with modes cheaper to maintain; the Notion variant needs unavailable infrastructure and its date-prefixed global temp files are weaker than the session workspace.
**Revisit if:** The modes acquire materially different lifecycle or safety contracts.

### SKL-07 · Delete skills that another skill already covers
`rejected` · 2026-08-25 · `01a03a89`
**Decision:** Removed `scaffold-one-off-script` because `prototype` covers it.
**Why:** Explicit user judgment, acted on immediately rather than deferred.
**Revisit if:** A recurring one-off scripting workflow appears that `prototype` does not serve.

### SKL-08 · Cognitive complexity is a diagnostic, not a target
`constraint` · 2026-08-24 · `01a03367`
**Decision:** Refactor for reader comprehension with guard clauses and cohesive extraction; never extract arbitrary helpers to move a metric.
**Why:** Score-gaming preserves or worsens the underlying design.
**Revisit if:** A measured threshold is part of a quality gate and the refactor still improves cohesion.

### SKL-09 · Prototypes are throwaway; surface follows audience
`constraint` · 2026-08-25 · `01a03a81`
**Decision:** Terminal/TUI prototype for developers with project tooling, self-contained HTML for non-developers. Preserve a prototype on a temporary branch only when it holds evidence that would otherwise be lost.
**Why:** A prototype answers a design question; it must not become an accidental product surface.
**Revisit if:** The prototype becomes a maintained artifact.

### SKL-10 · TDD workflow only where a cheap test seam exists
`constraint` · 2026-08-25 · `01a03a8a`
**Decision:** Use the TDD bug-fix workflow for explicit TDD/regression requests, or for an unrequested bug with an obvious cheap local seam. Skip unclear, expensive, or integration-heavy paths.
**Why:** Keeps red–fix–green practical instead of forcing tests where the path is uncertain.
**Revisit if:** A cheap reliable seam appears for the impractical case.

### SKL-11 · Domain context is a planning input
`constraint` · 2026-08-25 · `01a038b7`
**Decision:** For domain-affecting work, read existing bounded-context maps, vocabulary, context documents, and ADRs during planning — without adding ceremony to mechanical or CRUD work.
**Why:** Reduces proxy-driven changes, inconsistent terminology, and accidental context mergers.
**Revisit if:** The domain artifacts or planning workflow change substantially.

### SKL-12 · Ordered, mutually exclusive dispositions in the retrospective
`accepted` · 2026-08-25 · `01a03a63`
**Decision:** Replaced overlapping lesson classifications and owner categories with first-match ordered rules.
**Why:** "Reusable lesson", "one-off", and "already covered" were not mutually exclusive, so findings landed in several buckets.
**Revisit if:** A category appears that ordered rules cannot express.

### SKL-13 · Argument-less Wayfinder starts from Backlog
`accepted` · 2026-09-03 · `01a06622`
**Decision:** An invocation of Wayfinder without a map or destination inspects ready Backlog work and suggests candidates rather than asking the user to state a destination.
**Why:** The direct invocation is an intent to find the next useful work; an immediate open-ended clarification adds friction without consulting the available project state.
**Revisit if:** Wayfinder is deliberately restricted to map creation or map IDs become mandatory input.

### SKL-14 · Wayfinder candidates use structured selection
`accepted` · 2026-09-03 · `01a06622`
**Decision:** Surface Wayfinder's ranked next-ticket candidates through the harness's `ask_question`-format selection UI rather than prose.
**Why:** The candidate list is a choice point, so a selectable prompt makes the next action immediate and avoids another free-form response.
**Revisit if:** The shared harnesses no longer provide a compatible structured question interface.

### SKL-15 · Wayfinder dispatches on its entry path, with a first-call contract
`accepted` · 2026-09-03 · `01a06692-7a9e`
**Decision:** Restructured Wayfinder around its three entry paths (suggest work, work through a map, chart a map), each owning its own steps, with reference material moved after them. The skill now opens with a first-action contract: the first tool call is a Backlog read, never a clarification question. SKL-13 and SKL-14 are unchanged in substance.
**Why:** SKL-13 and SKL-14 already required this, but the rules sat in the second-to-last paragraph of a section headed for the opposite case, and session `01a066b3` opened with "What destination should Wayfinder chart?" before any tracker read, then reported candidates as prose. Placement, not policy, was the defect.
**Revisit if:** Wayfinder gains a fourth entry path, or the harness stops exposing a structured selection question.
**Limitation:** Four controlled probe runs before the change and four after both queried the tracker first, so the restructure is verified as non-regressive; the intermittent ask-first failure was never reproduced and cannot be proven eliminated.

### SKL-16 · Swarm has one shared workflow and no Pi prompt alias
`accepted` · 2026-09-03 · `01a0670d`
**Decision:** Moved the complete swarm protocol into the harness-neutral shared skill and removed Pi's separate `/swarm` prompt. Pi uses the standard `/skill:swarm` command; only the delegation call differs by harness.
**Why:** The prompt and skill duplicated ownership, while the shared skill was a Pi-only pointer that Claude could not follow. Keeping a compatibility prompt would preserve a second entry-point artifact without adding behavior.
**Revisit if:** A short `/swarm` alias proves materially more usable than the standard skill command.
**Evidence:** "Merge the swarm prompt into the swarm skill" and "Remove `/swarm` prompt".

### SKL-17 · Failure diagnosis uses symptom-specific modes
`accepted` · 2026-09-03 · `01a0670d`
**Decision:** Merged `triage-error` and `debug-empty-or-zero-output` into `diagnose-failure`, preserving error-first and input-first diagnostic orders as explicit modes. CI investigation and TDD remain separate lifecycle owners.
**Why:** Both skills shared the same root-cause-first contract and differed primarily in the order dictated by the symptom.
**Revisit if:** One mode acquires a materially different safety or output contract.

### SKL-18 · Retire unused or trivial workflow skills
`accepted` · 2026-09-03 · `01a0670d`
**Decision:** Removed `execute-plan` and `shortcut-ledger`. `execute-plan` was not part of Wayfinder and had no invocation in 546 retained Pi sessions or 24 retained top-level Claude sessions; its todo and command restrictions no longer matched either harness. The shortcut ledger wrapped a repository search while depending on an obsolete comment format.
**Why:** Neither skill carries a current, recurring workflow that justifies its own contract.
**Revisit if:** Approved external plan handoffs recur with a stable cross-harness lifecycle, or shortcut reporting requires more than repository search.

### SKL-19 · Verifier setup requires explicit invocation
`accepted` · 2026-09-03 · `01a0670d`
**Decision:** Made `wire-up-verifier` explicit-only while retaining its existing confirmation before repository changes.
**Why:** Missing verifier configuration during ordinary work is not itself user intent to add repository files or policy.
**Revisit if:** Projects adopt verifier scaffolding as a mandatory automatic setup step.

### SKL-20 · Quick-commit snapshots use a skill-local helper
`accepted` · 2026-09-10 · `01a08b8e`
**Decision:** Moved deterministic quick-commit snapshot capture into a tested script inside the shared skill; keep commit grouping in the read-only planner and irreversible Git actions in the parent.
**Why:** The ten latest concrete executions reconstructed the same snapshot in 3–7 shell calls, causing retries and sandbox failures before planning. Script the mechanical, repeatable capture without weakening the planner, confirmation, or staging-isolation boundaries.
**Revisit if:** The helper itself becomes a source of harness-specific incompatibility, or commit planning no longer needs a private snapshot.
**Evidence:** "Script the mechanics"

### SKL-21 · Skill descriptions state the surface, not the intent category
`accepted` · 2026-09-14 · `01a09fad`
**Decision:** `visual-verification` triggers on browser-rendered pages and explicitly excludes terminal/CLI/TUI output; `domain-modeling` no longer lists "record an architectural decision" as a trigger and takes decision recording only when the decision turns on unsettled domain concepts, rules, or invariants. Neither workflow, nor the ADR section, was otherwise changed.
**Why:** "anything a user sees" and "record an architectural decision" name the user's intent category rather than the surface each workflow can actually serve, so a terminal table change selected the Playwright capture workflow and a storage-engine ADR selected domain modeling. Fixed-fixture probes on `IM-GPT/gpt-5.6-terra` reproduced both false selections before the change and neither after, with the browser and domain positives unchanged.
**Revisit if:** A terminal capture workflow is added, or ADR authoring gains a single owning skill.
**Limitation:** Probes are single-model, small-sample selection checks, not a guarantee across harnesses or models.

### SKL-22 · Wayfinder and explain-code roots dispatch; paths load on demand
`accepted` · 2026-09-14 · `01a09fbf`
**Decision:** `wayfinder/SKILL.md` keeps the first-action tracker contract, path dispatch, session limits, modes, naming and Backlog ownership, and moves each entry path into `workflows/` with command reference and task templates in `reference/backlog-operations.md`; `explain-code/SKILL.md` keeps the read-only contract, mode dispatch, neighbor boundaries, evidence contract and presentation policy, and moves the three mode procedures into `modes/`. Nested documents use skill-root-relative paths, stated once in the root, rather than harness-absolute paths. Explain-code's HTML permission was also narrowed to explicit user request to match `shared/AGENTS.md`. SKL-06 and SKL-13 through SKL-15 are unchanged in substance.
**Why:** Every invocation previously loaded all three paths or all three modes. Keeping modes, session limits and the tracker-first rule in the root preserves the safety contracts that an on-demand read could miss, while path-specific procedure is the only part that varies per invocation.
**Revisit if:** A path or mode needs material from another path, or the harnesses stop resolving skill-relative document paths.
**Limitation:** Verified by single-model headless probes (`IM-GPT/gpt-5.6-terra`) on disposable fixtures: all three Wayfinder paths and all three explain-code modes dispatched correctly, with loaded skill bytes down 26–48%. The intermittent ask-first defect behind SKL-15 was not reproduced before or after, so it remains unproven either way.

### SKL-23 · Worker-first factual discovery, parent-owned reasoning
`accepted` · 2026-09-16 · `01a0aa6e-cecf-7666-a2e3-fc8aff4b3c5e`
**Decision:** Trigger the shared bulk-read workflow before broad discovery across candidate source, test, and reference files, not only after a blocked read. The parent locates paths and frames the factual question; the existing read-only worker extracts evidence; the parent inspects relevant original source for reasoning and edits. Preserve small direct lookups, required complete reads, worker permissions, and current routing limits. Do not add cumulative read enforcement or autonomous repository investigation.
**Why:** In session `01a0a9d0`, the parent delegated documentation extraction but read candidate source and tests directly in 350-line chunks. The former skill's coding/debugging exception made the task category a blanket escape from delegation. The user chose the instruction-first approach rather than tighter runtime enforcement. Spotify's Portal article supports the same extraction/reasoning split, but its reported token savings do not establish savings here.
**Revisit if:** Fresh-session trials continue broad parent paging, duplicate the worker's reads, miss relevant evidence, or show combined cost/latency outweighing context reduction.
**Evidence:** "Let's try 1."

### SKL-24 · Code explanations inspect source by claim, not by file inventory
`accepted` · 2026-09-16 · `01a0aa6e-cecf-7666-a2e3-fc8aff4b3c5e`
**Decision:** Replace explain-code's default complete-function-or-module reading instruction with delegated factual discovery and claim-driven direct inspection. Cited factual extraction can support an explanation without blanket rereading; original source remains necessary for behavioral inference, conflicting evidence, and consequential conclusions. Read complete functions when control flow matters, and stop when the requested explanation is supported or its uncertainties are explicit.
**Why:** Trial `01a0aa9c` loaded bulk-read and delegated before source reads, then made 22 parent source/test reads across 18 files. The old evidence contract was a plausible competing instruction, not proof that the worker failed. Requiring a purpose for follow-up reads preserves grounding without automatically duplicating discovery; it does not impose a hard budget or accept worker judgments as verified truth.
**Revisit if:** Explanations become poorly grounded, or fresh-session trials still reproduce broad parent rereading despite the narrower contract.
**Evidence:** "Does explain-code then have bad instructions? Can we change them?"

### SKL-25 · Bulk-reader answers replace factual rereading
`accepted` · 2026-09-16 · `01a0ab15-dbed-7666-a2e3-fc96e727ce37`
**Decision:** Refine the shared worker brief from a symbol map/next-read list to answered facts with source support, unresolved facts, and coverage limits. The parent uses supported facts directly, inspects unresolved reasoning or consequential claims, or discloses gaps that need not be resolved. Preserve exact-source inspection for edits and consequential conclusions, worker permissions, and existing routing thresholds. Do not interpret inaccessible or truncated evidence as absence, or confuse parent and worker transcript records.
**Why:** All three SEE trials (`01a0ab11-469d`, `01a0ab11-55d6`, `01a0ab11-65c1`) delegated successfully but then made substantial overlapping parent reads. Detailed worker line ranges in the third trial did not prevent duplication. A reading-map contract can turn extraction into a preliminary investigation rather than replacing factual reading; another generic no-rereading rule or tighter size gate does not address that handoff. The retrospective worker also mistook oversized transcript records for missing results, showing why coverage limits must be explicit. This is an instruction pilot, not a claim of proven savings.
**Revisit if:** Fresh-session trials show unsupported answers, excessive parent rereading, or combined cost/latency that outweighs context reduction.
**Evidence:** "OK please implement the suggestion"
