---
name: over-engineering-audit
disable-model-invocation: true
description: Use when the user wants a whole-repo simplification or over-engineering pass — "audit this repo for over-engineering", "what can we delete", "where are we reinventing stdlib", "where is this codebase over-built". Distinct from correctness review and targeted complexity refactoring. Returns a ranked delete-list; findings only, no auto-fix.
---

# Over-engineering audit

Start with the user-named area or an evidence-backed complexity hotspot, then return a ranked list of what to delete, simplify, or replace with standard-library or native equivalents. Widen to the whole codebase only when the evidence warrants it.

## When this triggers

- "Audit this repo for over-engineering" / "where is this over-built"
- "What can we delete" / "where are we reinventing the standard library"
- Inheriting or onboarding to a codebase and wanting the complexity hotspots

## Scope before scanning

Start in the area the user named: a feature, module, reported concern, or recent change. If none is named, identify a hotspot from repository evidence before broadening: a repeated pattern found by a targeted search, a concentrated recent-change area, or a test/incident that identifies the area. State that scope and evidence briefly.

Widen only when a finding crosses that boundary or independent evidence identifies another hotspot. Do not infer a whole-repository conclusion from one module.

## What it hunts for

- Dependencies that stdlib or the platform already provides
- Single-implementation interfaces and abstractions
- Factories that produce only one product
- Delegating wrappers that add no logic over what they wrap
- Files exporting a single item that could be inlined
- Dead config flags and unused features
- Hand-rolled implementations of standard-library functions

For an abstraction or layer, apply the deletion test before reporting it: trace its callers, contract, and tests, then ask whether callers could use the consolidated implementation without losing a real invariant, policy, representation boundary, or error translation.

Distinguish useful encapsulation from pass-through indirection. A useful module hides volatile representation, owns meaningful policy or state transitions, composes several operations, or gives callers a smaller observable contract. A pass-through wrapper mostly repeats the wrapped interface, renames calls, or forces callers to understand the same details anyway.

Assess indirection and hidden mutable state together. A layer earns its cost when it localizes state that would otherwise leak to callers or compresses several details behind a focused operation. It is a stronger deletion candidate when callers must still understand the state and the layer only delegates.

## Output format

When there are findings, state the scope and its evidence first. Then give one line per finding, ranked by impact (largest cut first). For each proposal, say whether it improves or degrades locality, caller leverage, hidden-state containment, and the observable test surface:

`<tag> <what to cut>. <replacement>. Why: <deletion-test result; locality, caller leverage, hidden-state, and observable-test-surface effects>. [path:line]`

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
- **No imported design workflow.** Do not impose domain vocabulary, edit a domain model, run a grilling loop, or design speculative interfaces. Route terminology and invariants to `domain-modeling`; route function-level control-flow refactors to `refactor-cognitive-complexity`.
- **Presentation is optional.** Use `present` only when a substantial audit result materially benefits from HTML; otherwise return the findings directly.
- **Verify before claiming reuse.** Before tagging something `stdlib`/`native`, confirm the replacement actually exists for this language/runtime and covers the edge cases the current code handles.

## Done means

- A ranked, one-line-per-finding delete-list with valid tags and paths.
- A `net:` savings estimate, or the `Lean already. Ship.` line.
