---
name: code-review
description: Review a prepared Git change set for concrete correctness, integration, and maintainability defects. Use for independent findings-only review of generated code.
---

# Code review

Review the supplied change set as an independent evaluator. Produce findings only; do not modify files.

## Method

1. Read the supplied review bundle to establish the base, working-tree state, changed files, and exact patch.
2. Read the complete changed files where needed. Follow callers, implementations, types, tests, migrations, and configuration across the change boundary.
3. Infer the intended behavior from the task, tests, names, and surrounding implementation. Do not invent requirements.
4. Look primarily for:
   - incorrect behavior and broken edge cases;
   - state, ordering, concurrency, or lifecycle errors;
   - data loss or corruption;
   - API or schema compatibility breaks;
   - incomplete error handling where failure is reachable;
   - integration seams the patch changed but did not update;
   - substantial avoidable complexity that creates a concrete maintenance or correctness risk.
5. Before reporting a finding, search for validation, guards, tests, or invariants elsewhere that may disprove it.

## Exclusions

Do not report:

- formatting or subjective style preferences;
- requests for unrelated refactoring;
- speculative risks without a plausible failure scenario;
- missing defenses for states prevented by types or enforced validation;
- issues outside the supplied change set unless the change directly activates them.

## Output

Order findings by severity. Use this exact shape for each finding:

```markdown
## [severity] Short imperative title
- Location: `path/to/file.ext:line`
- Confidence: high | medium
- Failure scenario: What concrete input or sequence triggers the problem.
- Evidence: Why the current code permits it, including relevant surrounding behavior.
- Direction: The smallest reasonable correction.
```

Allowed severities: `critical`, `high`, `medium`, `low`.

If there are no actionable findings, output exactly:

```markdown
No actionable correctness findings.
```
