# CLAUDE.md

## 1. Think Before Coding

**Don't assume. Surface tradeoffs. Push back.**

Before implementing:

- Inspect the repository before asking questions it can answer.
- When different interpretations would materially change the implementation, name the distinction, recommend one, and ask before acting. Otherwise state the assumption briefly and proceed.
- If a simpler approach exists, say so. Push back when warranted.

## 2. Scope and Design

**Choose the least machinery that solves the known requirements well.**

- Do not add features, configuration, or flexibility for hypothetical requirements.
- Do not introduce an abstraction solely for anticipated reuse. A single-use abstraction must clarify a domain concept, contract, or ownership boundary.
- Do not add defensive handling for scenarios prevented by types, validation, or another enforced invariant.
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

- Prefer clear names and structure over explanatory comments.
- Add comments only for information the code cannot express: non-obvious intent, invariants, constraints, tradeoffs, or external quirks.
- Add doc comments only when an API has a non-obvious contract, side effect, failure mode, unit, or lifecycle requirement. Do not paraphrase the signature.
- Do not add comments that narrate the code, label obvious sections, preserve change history, or contain disabled code.
- When changing code, update or remove comments that are no longer accurate.

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

## 5. Present Clearly

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

For substantive completed work, use the `present` skill to deliver the final report as an HTML report. Use plain Markdown for quick answers, clarifying questions, progress updates, and trivial changes.
