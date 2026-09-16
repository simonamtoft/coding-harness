---
name: explain-code
description: Use when the user explicitly asks to understand how code works, why a code or design decision has its current shape, or what a diff, branch, commit, or pull request changes. Selects a read-only how, why, or change explanation grounded in repository evidence; not for two-artifact comparison, defect review, technical-document authoring, or session retrospectives.
---

# Explain code from evidence

Build a useful mental model from the repository rather than paraphrasing source. Stay read-only: do not edit code, documentation, tasks, or configuration. Repository commands used only to inspect evidence are allowed; do not turn the explanation into an implementation or review.

## Select the mode and owner

Use this skill only for an explicit request to explain code or a code change. Choose one mode from the subject and question, then read only that mode's document:

| The request is about | Mode | Read |
| --- | --- | --- |
| “How does this work?”, a subsystem walkthrough, runtime trace, ownership map, or where existing behavior lives | How | `modes/how.md` |
| “Why is this designed this way?”, historical rationale, motivating constraints, or the origin of a code-level decision or value | Why | `modes/why.md` |
| “Explain/teach me this diff, branch, commit, or PR” in the context of the surrounding system | Change | `modes/change.md` |

When a request spans modes, pick the dominant mode and include only the supporting material needed from another. State the selected scope briefly when it is not obvious. Ask for clarification only when repository and conversation context cannot identify the target or when different bases would materially change a change explanation.

Keep these neighboring workflows under their existing owners:

- Use `compare-implementations` when the primary request is to enumerate differences between two artifacts.
- Use `code-review` or the harness review mechanism when the primary request is to find defects in a prepared change. Do not introduce findings or architecture critique into an explanation unless separately requested and clearly separated.
- Use `technical-writing` when the requested product is a technical document or a structural review of one.
- Use `analyze-sessions` in **repository retrospective** mode when the evidence subject is a completed agent session and the goal is durable process improvement.

## Evidence contract for every mode

1. **Establish scope.** Identify the subject, relevant symbols, and boundaries. For change mode, also establish the exact change range and base.
2. **Gather evidence, then inspect what the explanation needs.** For broad discovery, use `bulk-read` to extract facts from candidate files before reading their bodies. Request answers to the factual questions the explanation needs, with source support, unresolved facts, and coverage limits—not just a symbol map. Apply bulk-read's use/inspect/disclose triage: use supported facts directly, inspect unresolved reasoning or conflicting evidence, and disclose gaps that need not be resolved for this explanation. Do not turn every cited source into a reading assignment. Small, already-localized questions can stay direct.
   - Before each direct read, identify the claim or unresolved question it must support. Inspect original source for behavioral inferences, ambiguous or conflicting evidence, and consequential conclusions. Read the complete function when its control flow matters, following callers, callees, types, or effects only as needed to resolve that question. Do not default to whole-module reads or fixed-size paging through every cited file.
   - Delegated, source-backed factual findings can support the explanation without blanket rereading. They are not proof of correctness or absence: disclose material coverage gaps, and do not turn a worker's limited search into a repository-wide claim that no tests or callers exist. Preserve required complete reads of governing instructions and explicitly requested material.
3. **Track claims by kind.**
   - **Observed:** behavior, structure, or rationale explicitly supported by current code, tests, configuration, comments, history, tasks, documents, or review discussion. Cite a concrete `path:line`, symbol, commit, PR, task, or document.
   - **Inferred:** a conclusion assembled from indirect evidence. Label it as inference and give the evidence chain.
   - **Unknown:** a material question the available evidence does not answer. Name the gap instead of completing the story.
4. **Reconcile evidence.** Do not silently resolve contradictions between code, tests, comments, documentation, tasks, or history. State what conflicts and which source describes current behavior.
5. **Stay proportional and stop when supported.** Cover only the concepts needed for the question. Stop reading once those claims have evidence and material uncertainties are resolved or explicitly reported; do not recheck every supplied file merely to increase confidence. Prefer a short explanation for a narrow symbol; expand only for a cross-cutting subsystem or substantial change. Cite paths and symbols without producing annotated source.

Never mutate Backlog, Git history, or any other repository state while investigating.

## Presentation

Return concise Markdown. Use simple call trees, data-flow sketches, or small tables only when they reduce reader effort.

Use the existing `present` skill only when the user explicitly asks for a rich presentation or HTML report. In that case, complete the evidence investigation first, then give the presenter a source-of-truth brief with the selected mode, conclusions, citations, fact/inference distinctions, contradictions, and gaps. Let `present` own HTML construction and validation; do not create a parallel report pipeline here.

Do not include a quiz by default. Add one only when the user asks for it or when an explicitly instructional rich explanation would materially benefit, and keep it subordinate to the evidence-based explanation.
