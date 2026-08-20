---
name: debug-empty-or-zero-output
description: Use when a metric is zero, a test returns no rows, a script produces an empty file or empty result, an evaluation produces 0% accuracy, or any "I expected output but got nothing/zero" situation. Enforces a diagnostic order that checks inputs before producer logic, preventing the long debugging loops where the agent rewrites the producer when the real problem is upstream.
---

# Debug empty or zero output

When a producer (script, query, model, pipeline) returns nothing or zero, find the root cause in the right order — usually the data, not the code.

## When this triggers

- A metric reads `0`, `null`, or `NaN` when it should be non-zero
- A query, search, or filter returns no rows
- A test passes vacuously or a file is empty
- "Why is X 0?"
- "We're not getting any results"

## Diagnostic order

Walk these steps **in order**. Do not skip ahead. Most "empty output" bugs are in step 1 or 2, not step 4.

1. **Inputs exist and have the right shape.** Open the actual input file/table. Check row count, schema, sample values. Are they what the producer expects?
2. **Join / match keys agree.** If the producer joins or matches against a reference set: print a few keys from each side and compare. Mismatch here looks identical to a logic bug but isn't.
3. **Config is the one being used.** Print the effective config (not the file on disk — the merged runtime config). Confirm the environment, dataset id, threshold, filter is what you think it is.
4. **Producer logic.** Only now, after inputs/keys/config are confirmed correct, inspect the producer code itself.

## Rules

- **Smallest reproducing input first.** Before any code change, isolate one input row/record that *should* produce non-zero output and trace what the producer does with it.
- **Two-attempt rule on the producer.** If two attempts to fix the producer don't move the result, stop and go back to step 1. Don't fall into "let me try a different approach" loops — that signal is a hint you're in the wrong layer.
- **State the layer of every change.** Each fix should be tagged "input fix" / "key fix" / "config fix" / "logic fix". If you can't tag it, you don't yet know why it works.

## Common patterns

- Targets/labels not present in source list → 0% accuracy
- Join key has different casing/whitespace/type on each side → empty join
- Config points at the wrong dataset/environment → empty pull
- Filter excludes everything (off-by-one threshold, inverted predicate) → empty result
- Producer runs against stale cached output → results don't change despite code changes

## Done means

- The root cause is named and tagged (input / key / config / logic).
- The fix lives at the cause, not downstream of it.
- The reproducing input from step "smallest reproducing input first" now produces the expected non-zero output.
