# AGENTS.md

## 1. Think Before Coding

**Don't assume. Surface tradeoffs. Push back.**

Before implementing:

- Inspect the repository before asking questions it can answer.
- For domain-affecting work, before planning or implementing: read `CONTEXT-MAP.md`, when present, then the relevant `CONTEXT.md` and ADRs; otherwise read the root `CONTEXT.md` and ADRs. Use its vocabulary, flag boundary-conflicting terms or concept mergers, and preserve the requested user or business outcome—not only a technical proxy—in plans and success criteria.
- When different interpretations would materially change the implementation, name the distinction, recommend one, and ask before acting. Otherwise state the assumption briefly and proceed.
- Skip that check for trivial, mechanical, or ordinary CRUD work; do not create missing artifacts. If terms or rules remain unresolved, use `domain-modeling` to clarify them collaboratively and incrementally capture the resolution, not generate a comprehensive model.
- If a simpler approach exists, say so. Push back when warranted.

## 2. Scope and Design

**Choose the least machinery that solves the known requirements well.**

- Do not add features, configuration, or flexibility for hypothetical requirements.
- Do not introduce an abstraction solely for anticipated reuse. A single-use abstraction must clarify a domain concept, contract, or ownership boundary.
- Do not add defensive handling for scenarios prevented by types, validation, or another enforced invariant.
- At system boundaries, validate and parse external data into trusted, project-owned values. Report validation failures according to repository convention; do not silently coerce them or repeat validation after the invariant is enforced.
- Prefer representations that make invalid combinations unconstructable where practical. Introduce stronger types or value objects only for a demonstrated partial operation or semantic mix-up.
- Treat unchecked assertions and coercions as hazards: establish the fact through validation, narrowing, or an explicit, documented boundary assumption rather than hiding uncertainty from the code.
- When an authoritative schema or model defines a shape, derive from it rather than maintaining a duplicate definition.
- Name recurring, domain-significant, or specification-defined values. Keep self-explanatory one-off literals inline.
- Keep new fields, functions, and types private unless a current requirement needs broader access. Treat increased visibility as a public API decision, not a convenience.
- If the implementation is substantially larger than the problem requires, simplify it.
- Do not trade away correctness, robustness, or maintainability merely to reduce implementation effort.
- Keep the main path easy to follow. Prefer guard clauses over deep nesting and name complex domain conditions.
- Extract a helper only when it forms a cohesive concept with a precise contract; do not merely move branches elsewhere to satisfy a metric.

Document a deliberate limitation only when a future maintainer could reasonably mistake it for an oversight. Use one `shortcut:` comment naming the limitation and the condition that would justify replacing it.

## 3. Surgical Changes

**Touch only what your task requires. Every changed line should trace to the request.**

- Don't improve, refactor, or reformat working code you weren't asked to touch.
- Remove imports/variables/functions YOUR changes orphaned; leave pre-existing dead code (mention it, don't delete).
- Do not hand-edit generated artifacts or lockfiles. Use the owning tool for dependency changes and other tool-managed configuration so edits survive regeneration.

### Comments

- Prefer clear names and structure over explanatory comments. Add comments only for non-obvious intent, invariants, constraints, tradeoffs, or external quirks; add doc comments only for a non-obvious contract, side effect, failure mode, unit, or lifecycle requirement—not to paraphrase the signature.
- Do not add comments that narrate the code, label obvious sections, preserve change history, or contain disabled code. Update or remove comments that are no longer accurate.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

For multi-step work, state the success criteria and a brief plan. Skip the plan for trivial changes.

Rules for the loop itself:

- **Verification is external, not self-asserted.** Actually run the check — test, typecheck, lint, the app, or observability the repo exposes (traces, logs, tools like Langfuse).
- **Prefer the highest-fidelity check that's practical.** Choose the check closest to the changed user-visible behavior: end-to-end → integration → unit.
- **Reproduce bugs before fixing them when practical.** Add a regression test first when practical, observe it fail for the reported behavior, then pass after the fix. If local reproduction is not possible, use the closest observable signal and state the limitation.
- **Characterize behavior before structural refactors.** When changing complex or untested control flow, first cover branches, side effects, ordering, and failure paths with tests.
- **Feed the specific failure back.** Act on the exact signal — which assertion, which type error, which dependency — not a fresh guess.
- **Report what was verified.** Name the checks run and disclose anything that could not be tested.

## 5. Task Tracker Commands

**Consult the tracker only when the turn touches tracked work.** This narrows any project instruction that tells you to run `backlog instructions overview` before every request.

- Consult the tracker when a request names a task or asks about tracker state, a skill directs it, or before creating, planning, updating, or finalizing tracked work. Skip it for questions, explanations, debugging, code review, retrospectives, commits, and single mechanical edits.
- Whether work needs a task is normally known only after investigation, so consult it when acting on the work. A skill that mandates a first tracker read is the exception; that read is the disambiguation.
- Before a task lifecycle action, read `backlog instructions overview` and the matching `task-creation`, `task-execution`, or `task-finalization` guide, each at most once per session. Keep discovery targeted: use `backlog task list --ready --sort priority --limit 10 --plain`, `backlog search "<query>" --plain`, or `backlog task view <id> --plain`; inspect only the selected task and avoid bulk view loops or broad JSON listings.
- Never edit tracker markdown files directly. Use the CLI so metadata, relationships, and history stay consistent.

## 6. Present Clearly

**Use the smallest representation that exposes the important structure.**

- Keep prose concise and do not repeat what a visual already shows.
- Lead with the concrete answer. Cut generic introductions, recaps, conclusions, praise, and offers to continue when they add no value.
- Use plain words and active voice. Prefer specific facts, paths, commands, and measurements over abstract claims.
- Keep formatting proportional to the content. Avoid excessive headings, bold labels, and repetitive summary sections.
- Vary sentence structure naturally. Do not force ideas into a fixed number of bullets or reuse the same sentence pattern throughout.
- Use pseudocode, call trees, component trees, or shallow annotated file trees when they clarify behavior, ownership, or placement.
- Use types and signatures when contracts matter more than implementation details.
- Use tables for direct comparisons and conceptual `diff` blocks for structural changes; label non-literal diffs.
- Prefer text or ASCII diagrams. Use Mermaid only when it is clearer and the output surface can render it. Do not add a visual when a sentence is clearer.

Use plain Markdown for final delivery by default. Use the `present` skill to generate an HTML report only when the user explicitly requests it; it remains an opt-in workflow while it is being refined.
