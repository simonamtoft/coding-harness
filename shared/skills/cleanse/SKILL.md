---
name: cleanse
disable-model-invocation: true
description: Use when the user asks to cleanse a repository or feature — after heavy churn, a pivot, or before handing over a proof of concept or a 0→80% implementation. Finds documentation that drifted from the code, leftovers from abandoned approaches, redundant tests, and stale tracker items; proposes fixes and applies only the approved ones.
---

# Cleanse

Fast exploratory work leaves residue: documentation describing an approach that was later abandoned, files that nothing imports, tests for deleted code, and open tasks for finished work. A cleanse finds that residue so the next reader, often the person receiving a handover, can trust what the repository says about itself.

## Scope before scanning

Start with what the user named: a feature, a directory, a branch, or the whole proof of concept. If nothing is named, propose a scope from evidence and state it:

- On a feature branch, the changes since the branch point (`git diff $(git merge-base HEAD <default-branch>)`).
- On a proof-of-concept repository, the whole repository, because the whole repository is what gets handed over.

Read the documentation inside the scope completely. Read source files as far as the findings need, not file by file across the repository.

## What to check

### 1. Documentation drift

Compare what the documentation claims with what the code does. Include the README, agent instruction files (`AGENTS.md`, `CLAUDE.md`), `CONTEXT.md`, ADRs, decision ledgers, setup guides, `.env.example`, and architecture notes.

- Commands, scripts, paths, environment variables, or endpoints that the documentation mentions but the repository no longer has, and the reverse when a reader needs them.
- Documented decisions that the code now contradicts, or that describe an approach the project abandoned.
- Documents that contradict each other or repeat the same rule in different words.
- Links to files or sections that no longer exist.

Treat the code as the default source of truth for current behavior. When a document records an intended rule that the code violates, report the conflict and do not choose a winner: the user decides whether the code or the document is wrong.

### 2. Leftovers from abandoned approaches

- Files, exports, and dependencies that nothing uses.
- Configuration flags, environment variables, and feature paths that were half removed.
- Debug output, commented-out code, scratch files, and committed experiment artifacts.
- `TODO`/`FIXME` comments that refer to finished or abandoned work.

Prefer the project's own tooling for unused-code detection when it is configured, such as `knip`, `ts-prune`, `depcheck`, `vulture`, or linter rules for unused code. Ask before installing a new tool. Before reporting code as unused, search for dynamic references: string-based imports, reflection, framework conventions, configuration files, and entry points declared in manifests.

### 3. Test pruning

Flag tests that are completely redundant:

| Criterion | Proposed action |
|---|---|
| References code that no longer exists | Remove |
| Asserts only what the type system or framework already guarantees | Remove |
| Exactly duplicates another test's input and expected output | Remove the duplicate |
| Mocks a dependency to assert the same behavior that an integration test covers with the real dependency | Remove |
| Test helper or fixture that no test imports | Remove |

Keep tests that cover edge cases, failure paths, or regressions, even when a broader test covers the main path. Flag every uncertain case for the user instead of proposing removal.

### 4. Tracker and workspace hygiene

- Open tasks or issues whose work is merged, abandoned, or superseded. Use the project's tracker CLI and follow its workflow; do not edit tracker files by hand.
- Merged or abandoned branches, and worktrees with no active owner. Never remove a worktree or branch during the scan. Another session may own it.

### 5. Handover readiness

Apply this check when the cleanse precedes a handover:

- Follow the documented setup, test, and run instructions as a newcomer would. Run the cheap, non-destructive ones to confirm they work.
- Check that deliberate proof-of-concept shortcuts and known limitations are written down where the receiver will look for them.
- Check that the open work the receiver inherits is listed.

## Out of scope

Route other kinds of findings instead of absorbing them:

- Over-built abstractions and needless layers → `over-engineering-audit`.
- Correctness defects → `code-review`. Security defects, including committed secrets → `security-review`; report a committed secret immediately.
- Unsettled domain terminology or invariants → `domain-modeling`.
- Function-level control-flow refactors → `refactor-cognitive-complexity`.

## Output

State the scope and its evidence first. Then list the findings grouped by check, one line each:

`<tag> <finding>. Fix: <proposed change>. [path:line]`

Tags: **drift**, **dead**, **test**, **stale**, **handover**. Append `(uncertain)` when the evidence is incomplete, for example when a dynamic reference cannot be ruled out.

End with the number of findings for each tag. If nothing is found, output exactly `Clean. Nothing to remove.`

Then stop and let the user choose which fixes to apply.

## Applying approved fixes

- Apply only the findings the user approved. Removing files, tests, tasks, branches, or worktrees requires explicit approval of that finding or its group.
- Keep each change surgical. A documentation fix should change the drifted statement, not rewrite the document.
- Run the project's tests, type checks, and linters after removing code or tests, and report the results.
- Do not create branches, commits, pull requests, or merges unless the user asks.

## Done means

- The scope and evidence are stated, and a tagged findings list or the `Clean. Nothing to remove.` line is reported.
- Approved fixes are applied and verified with the project's checks, or the user declined them.
