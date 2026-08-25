---
name: tdd-bug-fix
description: Use only when the user explicitly asks for TDD, a failing test, or a regression test, or when an unrequested bug fix has an obvious cheap local test seam. For unrequested bugs, skip when the test path is unclear, expensive, or integration-heavy.
---

# TDD bug fix

When fixing a bug with a clear, cheap test path, make the broken behavior executable before changing production code. The goal is a focused regression test that fails before the fix and passes after it.

Do not force a test when it would be impractical. If the available test would require broad harness setup, brittle mocks, slow end-to-end infrastructure, production-only state, vague reproduction steps, or large unrelated fixture churn, skip adding a new test and use the closest useful verification instead.

## Boundaries

Use narrower workflows first when they apply:

- Diagnose pasted errors and name their root cause with `triage-error` before applying this workflow.
- For empty or zero output, follow `debug-empty-or-zero-output` and check inputs, keys, and effective configuration before producer logic.
- Investigate red CI with `investigate-failing-ci`; classify infrastructure, real failures, and flakes before treating a failure as a code regression.
- Use the characterization workflow in `refactor-cognitive-complexity` for behavior-preserving complexity refactors.

Do not use this skill for exploratory diagnosis, broad integration verification, production-only incidents, or behavior-preserving refactors without a bug. This is a focused bug-fix workflow, not a default development methodology.

## Workflow

1. **Understand the bug.** Identify the intended behavior, current behavior, affected path, and smallest observable reproduction.
2. **Choose the narrowest executable check.** Prefer the closest unit, component, integration, or regression test already used for that code path. If no practical test path is obvious, do not create one from scratch just to satisfy the workflow.
3. **Write the failing test first.** Add the smallest focused test that would have caught the bug. The test should encode intended behavior, not mirror the current implementation.
4. **Run the new test before fixing.** Confirm it fails for the intended reason. If it passes or fails for an unrelated reason, correct the test or reproduction before editing the implementation.
5. **Fix the bug.** Make the smallest production change that satisfies the intended behavior while preserving nearby contracts.
6. **Rerun the regression test.** Confirm the test now passes.
7. **Run nearby validation.** Run relevant adjacent tests, type checks, lint, or scenario checks when the change has broader risk.

## If a failing test is impractical

Do not silently skip the regression step. Before fixing, explicitly record why a durable failing test is impossible or not worth the cost, then choose the closest executable regression check available. Examples include a targeted script, manual reproduction command, browser automation, snapshot comparison, log assertion, or focused integration check.

Run that check before the production fix and confirm it demonstrates the bug for the intended reason. Run the same check after the fix and confirm the corrected behavior. If no before-fix check is executable, state that limitation rather than claiming red evidence.

Prefer no new test over a bad test. A bad test is one that mostly tests mocks, encodes current implementation details, depends on timing or unrelated global state, needs expensive infrastructure for a small fix, or would be deleted immediately after proving the fix.

## Guardrails

- Do not change tests merely to match a wrong implementation.
- Do not weaken existing assertions unless the expected behavior has genuinely changed and the reason is clear.
- Keep the regression test focused on the bug; avoid broad fixture churn or unrelated coverage expansion.
- Do not add tests when the practical signal is weak; use manual or scripted verification and say why.
- If the bug is flaky, make the test deterministic where possible and document the signal being locked down.
- If the bug exposes a broader class of failures, first land the focused regression path, then consider additional sibling coverage.

## Final response

Report the evidence, not just the outcome:

- Name the failing-before test or executable check and the failure it produced.
- Name the passing-after test run and any nearby validation performed.
- If failing-before evidence could not be demonstrated, state why and describe the closest regression check used instead.
