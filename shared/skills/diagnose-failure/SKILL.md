---
name: diagnose-failure
description: Diagnose errors, exceptions, build failures, or unexpectedly empty and zero output before proposing a fix. Selects an error-first or input-first investigation path, names the owning layer and root cause, and avoids changing the wrong layer.
---

# Diagnose a failure

Find the root cause before proposing a fix. Select one mode from the observed symptom; do not mix their diagnostic order.

## Select the mode

- **Error mode:** a stack trace, compiler or build error, runtime exception, HTTP/auth failure, or stderr block exists.
- **Empty-output mode:** a metric is unexpectedly zero, null, or `NaN`; a query returns no rows; a test passes vacuously; or a script produces an empty result without an error.
- **CI run:** use `investigate-failing-ci` instead. It owns workflow inspection and infrastructure/real/flake classification.

## Shared contract

1. Establish the exact command, input, environment, intended behavior, and current behavior.
2. Reproduce with the smallest input or action that should demonstrate the failure.
3. Name the owning layer and root cause before proposing a fix. Distinguish the cause from the line, exception, or empty result that exposed it.
4. Propose one concrete correction at the cause. Do not spray hypotheses or change downstream code to compensate for an upstream problem.
5. Run or describe the same focused reproduction after the correction and confirm the expected result.

Read-only repository lookups are allowed. Print mutating or environment-changing diagnostic commands for the user unless they explicitly authorize execution. If the first hypothesis is disproved, say so and restart from the relevant mode rather than stacking speculative fixes.

## Error mode

Investigate in this order:

1. **Identify the layer:** compile/build, runtime, infrastructure, test framework, or OS/shell.
2. **Read the last error first.** The innermost frame or final stderr line is usually closest to the cause.
3. **Trace upstream from trigger to cause.** For example, a null dereference is the trigger; the missing configuration or unexpected null return may be the cause.
4. **Match the fix to the layer.** Do not propose application code changes for an infrastructure failure or environment changes for a logic bug.

Check version and installation state for dependency failures, credentials or permissions for auth failures, resource ownership for ports and file locks, platform path and encoding assumptions, configured limits for OOM and timeouts, and stale artifacts only when the evidence makes them plausible.

## Empty-output mode

Investigate in this order; do not inspect producer logic until the first three layers are confirmed:

1. **Inputs:** open the actual input source and check its count, schema, and representative values.
2. **Join or match keys:** compare sample keys from both sides, including type, casing, and whitespace.
3. **Effective configuration:** inspect the merged runtime configuration, environment, dataset, threshold, filters, and cache actually in use—not only the file on disk.
4. **Producer logic:** trace the smallest input that should produce a non-empty result through filters, branches, and output construction.

Tag the cause as `input`, `key`, `config`, or `logic`. If two attempted producer fixes do not move the result, stop and return to the input checks.

## Done means

- The selected mode and owning layer are explicit.
- The root cause—not merely the trigger—is named with supporting evidence.
- One correction is tied to that cause.
- The smallest reproduction demonstrates the expected result afterward, or the verification limitation is stated.
