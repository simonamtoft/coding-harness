---
name: explain-code
description: Use when the user explicitly asks to understand how code works, why a code or design decision has its current shape, or what a diff, branch, commit, or pull request changes. Selects a read-only how, why, or change explanation grounded in repository evidence; not for two-artifact comparison, defect review, technical-document authoring, or session retrospectives.
---

# Explain code from evidence

Build a useful mental model from the repository rather than paraphrasing source. Stay read-only: do not edit code, documentation, tasks, or configuration. Repository commands used only to inspect evidence are allowed; do not turn the explanation into an implementation or review.

## Select the mode and owner

Use this skill only for an explicit request to explain code or a code change. Choose the mode from the subject and question:

- **How** — “How does this work?”, a subsystem walkthrough, runtime trace, ownership map, or question about where existing behavior lives.
- **Why** — “Why is this designed this way?”, historical rationale, motivating constraints, or the origin of a code-level decision or value.
- **Change** — “Explain/teach me this diff, branch, commit, or PR” in the context of the surrounding system.

When a request spans modes, pick the dominant mode and include only the supporting material needed from another. State the selected scope briefly when it is not obvious. Ask for clarification only when repository and conversation context cannot identify the target or when different bases would materially change a change explanation.

Keep these neighboring workflows under their existing owners:

- Use `compare-implementations` when the primary request is to enumerate differences between two artifacts.
- Use `code-review` or the harness review mechanism when the primary request is to find defects in a prepared change. Do not introduce findings or architecture critique into an explanation unless separately requested and clearly separated.
- Use `technical-writing` when the requested product is a technical document or a structural review of one.
- Use `repo-session-retrospective` when the evidence subject is a completed agent session and the goal is durable process improvement.

## Evidence contract for every mode

1. **Establish scope.** Identify the subject, relevant symbols, and boundaries. For change mode, also establish the exact change range and base.
2. **Inspect the implementation.** Read the complete relevant functions or modules, then follow enough callers, callees, types, configuration, tests, and effects to explain the behavior without guessing from names or a diff alone.
3. **Track claims by kind.**
   - **Observed:** behavior, structure, or rationale explicitly supported by current code, tests, configuration, comments, history, tasks, documents, or review discussion. Cite a concrete `path:line`, symbol, commit, PR, task, or document.
   - **Inferred:** a conclusion assembled from indirect evidence. Label it as inference and give the evidence chain.
   - **Unknown:** a material question the available evidence does not answer. Name the gap instead of completing the story.
4. **Reconcile evidence.** Do not silently resolve contradictions between code, tests, comments, documentation, tasks, or history. State what conflicts and which source describes current behavior.
5. **Stay proportional.** Cover only the concepts needed for the question. Prefer a short explanation for a narrow symbol; expand only for a cross-cutting subsystem or substantial change. Cite paths and symbols without producing annotated source.

## How mode

Trace the real system in the order a reader needs:

1. Find the entry point or trigger and identify which package or component owns it.
2. Follow the call path through important decisions, state transitions, and data transformations.
3. Identify observable effects and boundaries: persistence, network or process calls, emitted events, rendering, scheduling, logs, or returned values, as applicable.
4. Explain where the important types, modules, and tests live and what responsibility each owns. Describe current placement and enforced dependency direction; do not turn this into advice about an unrequested redesign.
5. Surface only useful non-obvious constraints, such as ordering, lifecycle, validation, concurrency, compatibility, or generated-code boundaries, with evidence.

A typical answer is: a one-paragraph overview, a numbered runtime flow, a compact ownership map, and a short constraints section. Omit any section that adds no value.

## Why mode

Code shape is not evidence of its own motivation. Anchor the target in current code, then search the rationale record that is actually available:

- `git blame`, file history through renames, commits, and merge messages;
- pull-request descriptions, reviews, and linked issues when repository remotes and credentials make them accessible;
- Backlog tasks, ADRs, design documents, README or runbook material, tests, and code comments;
- other repository-configured evidence sources relevant to the target.

Search by symbols, paths, old names, commit IDs, task or issue IDs, and domain terms. Follow links between sources rather than treating the newest commit as the whole history. Never mutate Backlog while investigating.

Report rationale using distinct sections:

- **Direct evidence:** explicit statements of intent or constraint, each cited.
- **Reasonable inference:** evidence chain and calibrated wording such as “likely” or “suggests.”
- **Contradictions:** sources that disagree or describe different points in time.
- **Unknowns and unavailable sources:** searches with no result, inaccessible PRs or systems, and questions the record does not answer.

If direct evidence is absent, say so. Current code can support an explanation of mechanics but cannot by itself prove why a decision was made.

## Change mode

1. Identify the target and base before interpreting the patch:
   - working tree: distinguish staged and unstaged changes, normally against `HEAD`;
   - commit: use its parent, accounting for merge commits;
   - branch: use the merge base with the repository’s default or user-named base branch;
   - pull request: use its recorded base and head when available.
2. Read the whole change, then inspect the surrounding pre-change and current implementation, callers, contracts, and focused tests needed to understand it.
3. Give only the background required to understand the change. Do not write a generic subsystem tour first.
4. Explain the core intuition with a concrete input, state transition, request, or other small example when that clarifies the design.
5. Walk the change in a coherent conceptual or runtime order: contract and data model, producer, consumer, effects, then tests is one common sequence. Group related edits across files; do not restate hunks in file order. Describe changed ownership or placement factually; do not label it right, wrong, better, or worse unless critique was separately requested.
6. End with the resulting behavior and important unchanged boundaries. This is teaching, not approval: do not imply correctness merely because the change is understandable.

A typical answer is: scope/base, necessary background, core intuition, ordered walkthrough, and resulting behavior. Keep examples faithful to the inspected code and label simplified values as illustrative.

## Presentation

Return concise Markdown by default. Use simple call trees, data-flow sketches, or small tables only when they reduce reader effort.

Use the existing `present` skill only when the user explicitly asks for a rich presentation or when a substantial explanation materially benefits from a self-contained HTML report. In that case, complete the evidence investigation first, then give the presenter a source-of-truth brief with the selected mode, conclusions, citations, fact/inference distinctions, contradictions, and gaps. Let `present` own HTML construction and validation; do not create a parallel report pipeline here.

Do not include a quiz by default. Add one only when the user asks for it or when an explicitly instructional rich explanation would materially benefit, and keep it subordinate to the evidence-based explanation.
