---
name: compare-implementations
description: Use when the user asks to compare two files, functions, modules, or implementations — "what's the difference between X and Y", "are these the same", "why does X behave differently than Y". Read-only by default; surfaces a structured difference list and never edits either side in the same turn.
---

# Compare two implementations

Walk two similar artefacts (files, functions, modules, docs) and produce a structured difference report — without editing either of them.

## When this triggers

- "What's the difference between X and Y"
- "Are these two files the same / equivalent"
- "Compare these two functions / strategies / scripts"
- "Why does X work differently than Y"
- "Diff this against that"

## Procedure

1. **Read both sides fully before comparing.** Don't start diffing after reading only one. If one side is much larger, ask the user to narrow the scope before continuing.
2. **Produce a structured output:**
   - **Summary** — 3-5 bullets covering the headline differences.
   - **Details** — a side-by-side table if there are multiple discrete differences, or a numbered list otherwise. Each item references the location in both files (path:line if applicable).
   - **Implications** — which one to use when, or what would need to change to make one match the other.
3. **Categorise every difference** with one of:
   - **Behavioural** — the two artefacts produce different results
   - **Structural** — same behaviour, different shape (refactor-equivalent)
   - **Cosmetic** — naming, formatting, comments, ordering
4. **Note what's the same** when it's load-bearing — e.g. "both validate the same way, both call the same downstream function".

## Rules

- **Read-only.** Do not edit either file in the same turn. The output is information, not a reconciliation. If the user follows up with "make them the same", that's a separate turn where you can confirm scope.
- **Don't speculate about intent.** If you can't tell why the two diverged, say "I don't know why these differ" — better than inventing a rationale.
- **Don't flag what you didn't read.** Comparison must cover the whole of both sides at the scope agreed; partial comparisons must be labelled as such.
- **No "better" / "worse" judgments** unless asked. A comparison is descriptive; quality is a separate question.

## Output shape (template)

```
## Summary
- <difference 1>
- <difference 2>
- ...

## Details
| Aspect | File A | File B | Category |
|---|---|---|---|
| ... | ... | ... | behavioural / structural / cosmetic |

## Implications
- <when to use which, or what reconciliation would require>
```

## Done means

- Every meaningful difference is listed and categorised.
- No file was edited.
- The user can decide what to do next (reconcile, choose one, leave both) with the information in hand.
