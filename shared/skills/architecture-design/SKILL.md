---
name: architecture-design
description: Design consequential technical changes before implementation. Use for explicit architecture or design requests, or when choosing a hard-to-reverse interface, schema, ownership boundary, concurrency model, or public API; do not use for routine coding.
---

# Architecture design

Use this workflow to make a consequential technical decision legible before code commits the system to it. The outcome is a concise design artifact and an explicit decision point, not an implementation plan by default.

## Trigger and boundary

Use this skill when the user explicitly requests architecture or design work, or when the change chooses one of these high-cost or hard-to-reverse shapes:

- an interface used across modules, services, or independently deployed clients;
- a persisted schema or serialized format;
- ownership of data, behavior, lifecycle, or side effects across a boundary;
- a concurrency, scheduling, cancellation, retry, or consistency model;
- a public API, CLI, event, plugin contract, or extension point.

Do **not** invoke it for routine local implementation, a contained bug fix, an obvious extension of an established pattern, or a reversible internal refactor. Those still require the repository's normal investigation and clarification practices.

Do not use an architecture label to bypass the clarification gate. When an unresolved choice would materially change behavior, data, public contracts, or acceptance criteria, state the decision context and ask before selecting it.

## Workflow

1. **Ground the existing system.** Read the relevant callers, implementations, types, tests, configuration, persisted or wire formats, and lifecycle paths. Identify established terminology, conventions, constraints, and the actual seam being changed. Do not infer a contract from the requested implementation alone.

2. **Start with callers.** Show the intended usage before designing internals. Include a short representative call, request/response exchange, event flow, or lifecycle trace. State who calls it, what they need, and what observable result or failure behavior they rely on.

3. **Make the contract concrete.** Define the proposed types or signatures, including important inputs, outputs, ownership, errors, ordering, and lifecycle rules. Keep this at the narrowest level that makes compatibility and invalid states clear; do not create a full scaffold or implementation merely to demonstrate it.

4. **Map modules and ownership.** Provide a shallow map of the affected modules or components. Name the owner of each important responsibility, state, and side effect, and label the boundaries where data or control crosses. Prefer an ASCII diagram or short table when it makes the handoffs clearer.

5. **Record constraints and trade-offs.** List the constraints imposed by current callers, compatibility, data, performance, operations, security, or team conventions. Compare the viable approaches and make the selected trade-off explicit, including what the design intentionally does not optimize for.

6. **Pause before implementation.** Present the artifact and decision. Implementation happens only when the user asks for it or an already-approved task requires it. If new evidence makes the shape wrong, revise the artifact rather than forcing the implementation through it.

## Use other design evidence only when needed

This workflow owns technical contracts, module boundaries, and trade-offs. Bring in another method only for a distinct unanswered question:

- Use `/domain-modeling` when the decision depends on ambiguous domain terms, invariants, valid state combinations, or an ADR-worthy domain boundary. Do not use it merely to name modules or types.
- Use `/prototype` when executable interaction, a state transition, or a UI shape is the cheapest way to test an assumption. Treat the prototype as throwaway evidence, not the production design.
- Generate multiple design candidates only when the alternatives differ structurally and comparing them would resolve a real trade-off. Otherwise state the viable alternative and why it loses; do not create variants, solicit fixed models, or run an arena by default.

## Design artifact

Keep the artifact proportional to the decision. For a typical consequential change, use this shape in the response, task, ADR, or design document appropriate to the repository:

```markdown
## Context and constraints
<Existing callers, boundaries, conventions, compatibility or operational facts.>

## Caller-first usage
<Representative call, request/response, event flow, or lifecycle trace.>

## Proposed contract
<Types or signatures, ownership, error behavior, ordering, and lifecycle rules.>

## Module and ownership map
<Shallow components and the owner of each responsibility and side effect.>

## Alternatives and trade-offs
<Viable choices, selected direction, costs, and deliberate non-goals.>

## Decision needed
<The choice to approve, plus any remaining question that needs clarification.>
```

Omit headings that genuinely do not apply, but do not omit the caller perspective, concrete contract, ownership, constraints, or trade-off that justify the decision.

## Non-goals

- No mandatory multi-model review, fixed model list, or external orchestration dependency.
- No required scaffold commit, task structure, or generated implementation.
- No automatic implementation after a design artifact; keep design approval and execution as separate user decisions unless an approved task already joins them.
