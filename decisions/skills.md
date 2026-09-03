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

