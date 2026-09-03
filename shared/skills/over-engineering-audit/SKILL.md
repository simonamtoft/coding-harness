---
name: over-engineering-audit
disable-model-invocation: true
description: Use when the user wants a whole-repo simplification or over-engineering pass — "audit this repo for over-engineering", "what can we delete", "where are we reinventing stdlib", "where is this codebase over-built". Distinct from correctness review and targeted complexity refactoring. Returns a ranked delete-list; findings only, no auto-fix.
---

# Over-engineering audit

Scan a whole codebase for redundancy and unnecessary complexity, and return a ranked list of what to delete, simplify, or replace with standard-library or native equivalents.

## When this triggers

- "Audit this repo for over-engineering" / "where is this over-built"
- "What can we delete" / "where are we reinventing the standard library"
- Inheriting or onboarding to a codebase and wanting the complexity hotspots

## What it hunts for

- Dependencies that stdlib or the platform already provides
- Single-implementation interfaces and abstractions
- Factories that produce only one product
- Delegating wrappers that add no logic over what they wrap
- Files exporting a single item that could be inlined
- Dead config flags and unused features
- Hand-rolled implementations of standard-library functions

## Output format

One line per finding, ranked by impact (largest cut first):

`<tag> <what to cut>. <replacement>. [path:line]`

Tags:

- **delete** — unused code or speculative feature; no replacement needed
- **stdlib** — hand-rolled logic the standard library already covers
- **native** — a platform capability (CSS, HTML, SQL constraint, etc.) being reimplemented
- **yagni** — abstraction or layer serving a single use case / caller
- **shrink** — same behavior achievable in fewer lines

Close with an estimate: `net: -<N> lines, -<M> deps possible.`
If there is nothing to cut, output exactly `Lean already. Ship.`

## Scope boundary

- **Complexity only.** Do not report correctness bugs, security holes, or performance issues — those route to `code-review` and `security-review`.
- **Findings only.** Propose; don't apply. The user decides what to cut.
- **Verify before claiming reuse.** Before tagging something `stdlib`/`native`, confirm the replacement actually exists for this language/runtime and covers the edge cases the current code handles.

## Done means

- A ranked, one-line-per-finding delete-list with valid tags and paths.
- A `net:` savings estimate, or the `Lean already. Ship.` line.
