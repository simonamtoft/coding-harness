---
name: refactor-cognitive-complexity
description: Refactor functions with high cognitive complexity while preserving behavior. Use when SonarQube/SonarCloud reports a cognitive-complexity issue, a function has deeply nested conditionals or loops, or the user asks to simplify hard-to-follow control flow. Requires characterization tests, identifies the constructs driving complexity, and favors early returns, named conditions, and cohesive extraction over score-gaming.
---

# Refactor cognitive complexity

Reduce the mental effort required to follow a function's control flow without changing its behavior.

Cognitive complexity is a signal, not the goal. A successful refactor makes the code easier to understand and verify; merely moving branches into arbitrary helpers to satisfy a threshold is not enough.

## When this triggers

- SonarQube or SonarCloud reports that a function exceeds its cognitive-complexity threshold
- A function contains deeply nested conditionals, loops, catches, switches, or mixed logical operators
- The user asks to flatten, simplify, split up, or reduce the cognitive complexity of code

## Core model

Complexity generally rises when code:

- breaks linear reading flow with conditionals, loops, catches, switches, recursion, or jumps
- nests flow-breaking structures inside one another
- combines logical conditions in a way that forces the reader to track operator sequences

Ordinary method calls are free in the metric because a well-named call provides a readable summary. Recursive calls are not free.

For JavaScript and TypeScript, treat each function independently, including nested functions and callbacks. Do not add the enclosing function's nesting level to a nested function's score. In Sonar's JavaScript calculation, `||` and `??` expressions are excluded from logical-expression increments; use the repository's configured analyzer as the authority for exact scoring.

## Procedure

### 1. Establish the target

1. Read the entire function and its direct callers, callees, tests, and relevant types.
2. Record the analyzer's rule, current score, and threshold when available. Do not guess an exact score if no analyzer reports one.
3. State the observable behavior that must remain unchanged: return values, mutations, ordering, exceptions, logging, I/O, and timing-sensitive effects.

### 2. Secure behavior before refactoring

Run the narrowest existing tests that exercise the target. If coverage is missing, add characterization tests before changing structure. Cover:

- each branch and early-exit path
- boundary and nullish inputs
- exception paths
- ordering of side effects
- combinations represented by a complex condition

If tests cannot be added or run, stop and tell the user what prevents safe refactoring. Do not perform a behavior-sensitive rewrite on confidence alone.

### 3. Map the complexity drivers

Annotate the function privately or in the work report, not with permanent score comments in production code. Identify:

- nesting depth and nested flow structures
- long or mixed boolean expressions
- repeated branch bodies or predicates
- distinct phases or responsibilities
- exceptional cases buried inside the happy path
- mutable state shared across branches

Use the analyzer output for exact accounting. Manual scoring is only an estimate because language and analyzer versions differ.

### 4. Choose the smallest structural improvement

Apply these in order where they improve readability:

1. **Flatten with guard clauses.** Handle invalid, exceptional, or terminal cases first and return or continue early.
2. **Replace null guards with null-safe syntax.** Use optional chaining, null coalescing, pattern matching, or the language's equivalent when semantics remain identical.
3. **Name a complex condition.** Extract a pure predicate when its name communicates domain meaning better than the expression.
4. **Consolidate duplicated branches.** Combine branches only when their behavior and side-effect ordering are genuinely equivalent.
5. **Extract cohesive phases.** Split a large function along responsibilities or transformations, with explicit inputs and outputs.
6. **Replace control flow with a clearer native construct.** For example, use a lookup, collection operation, or pattern match only when it is more direct for this codebase.

Prefer pure helpers. Keep helpers near their single caller unless repository conventions dictate otherwise. Preserve the original vocabulary and abstraction level.

### 5. Check for displaced complexity

After each extraction, ask:

- Does the caller now read as a meaningful high-level story?
- Does the helper have one cohesive purpose and a precise name?
- Are inputs and outputs explicit rather than coupled through shared mutable state?
- Did total comprehension improve, or did the branches merely move elsewhere?
- Is navigation now excessive for a short, locally understandable operation?

Undo extractions that only game a per-function threshold. Do not introduce strategy classes, generic rule engines, configuration, or abstractions unless the existing domain already calls for them.

### 6. Verify

1. Run the characterization and existing relevant tests.
2. Run typecheck and lint when available.
3. Run the configured Sonar analyzer or repository complexity check when practical.
4. Review the diff for changed side-effect order, altered short-circuit behavior, broadened exception handling, and accidental API changes.

If the analyzer remains above threshold, use its updated finding to repeat from step 3. Do not blindly extract another block.

## Semantic traps

Pay special attention to:

- changing short-circuit evaluation that previously skipped calls or property access
- replacing `if` chains with independent guards when multiple branches can now execute
- changing `else if` precedence or switch fallthrough
- moving code across `try`, `catch`, `finally`, transaction, lock, or resource scopes
- changing loop `break`, `continue`, or return behavior during extraction
- converting falsy checks to nullish checks, or vice versa
- evaluating getters, iterators, callbacks, or async operations a different number of times
- parallelizing work that was ordered

## Rules

- **Behavior preservation is mandatory.** Complexity reduction does not justify feature changes.
- **Tests come first.** Characterize untested behavior before editing complex control flow.
- **Do not optimize only for the score.** A lower number with fragmented or misleading code is a failed refactor.
- **Do not claim an exact score without tool output.** Sonar implementations vary by language and version.
- **Keep scope surgical.** Refactor the reported unit and only the surrounding code needed to support it.
- **Use comments sparingly.** Prefer names and structure; do not leave cognitive-complexity arithmetic in production code.

## Completion report

Report:

- the function(s) refactored and their original complexity drivers
- the structural changes made
- the behavior-preserving tests and checks run
- analyzer score before and after, if measured
- any verification limitation

## Done means

- Relevant behavior was characterized before the refactor.
- The target control flow is flatter or divided into cohesive, well-named units.
- Side effects, exceptions, and ordering remain unchanged.
- Relevant tests and repository checks pass.
- The configured threshold passes when the analyzer is available, without arbitrary helper extraction.
