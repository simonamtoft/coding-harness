---
name: quick-commit
description: Use when the user wants changes actually committed — "quick commit", "commit this", "commit these changes", "commit and push". Groups the working tree into one or more coherent commits, writes a message per commit in the repo's style, and commits after a single confirmation. Distinct from generate-commit-message, which only proposes one message line and never commits.
---

# Quick commit

Take the current working tree and turn it into commits — the *action*, not just the message. The core job is honouring commit boundaries: a working tree often holds more than one logical change, and each should land as its own commit with its own message, never bundled into a portmanteau.

This is the committing counterpart to `generate-commit-message` (which only prints one line and never commits). Use that one when the user wants text to paste; use this one when they want the commits made.

## When this triggers

- "quick commit"
- "commit this" / "commit these changes"
- "commit and push"
- "commit what we've got" / "just commit it"

## Procedure (in this order)

1. **Create a private working-tree snapshot.** Create a mode-0700 temporary directory under `${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}`. Write any user-stated scope, `git status --short`, `git diff` (unstaged), `git diff --staged`, and the repository-style evidence required by `../_shared/commit-message-rules.md`, resolved from this skill directory, to a mode-0600 snapshot file. For every nonignored untracked path, include its type and byte size; include regular-file contents as a diff against an empty temporary file. Mark unreadable, nonregular, or binary files whose contents cannot be captured as requiring a warning and exclusion from automatic staging. Do **not** read the snapshot or emit the diff into the parent context. The command may report only whether the status is empty; if it is, report no work and stop.

2. **Delegate all diff analysis.** Dispatch exactly one cheap, read-only `commit-planner` subagent with the snapshot's absolute path — never put the full diff in the delegation prompt. The planner is the sole reader of the working-tree evidence. It returns either a ready commit plan or a blocking clarification. Retain the temporary directory until the planner returns a ready plan or the user cancels; then remove it. The parent retains all staging, committing, pushing, and user confirmation.

   - **Pi:** invoke `subagent` with `agent: commit-planner`, `agentScope: user`, and `cwd` set to the snapshot directory, so its read-only tools can access the snapshot. The task contains only its filename and the requested output.
   - **Claude Code:** invoke `Task` with `subagent_type: commit-planner` and a prompt containing the snapshot path, requested output, and active working directory.

3. **Resolve a blocking clarification.** If the planner returns one, call `ask_question` exactly once with its `question`, plain-text `details`, and up to three labelled options. The details must show the safe groups, proposed messages, and the specific ambiguity; the options describe the resolution paths. Do not read the snapshot to second-guess the planner or silently fold material into a group. After the user answers, re-dispatch the planner with that answer and the same snapshot. Repeat only if it returns another blocking clarification. Present the commit plan only after it returns ready.

4. **Surface non-blocking warnings.** If a ready plan reports a mixed-concern file, possible secrets, credentials, client data, generated material, uncaptured or nonregular untracked paths, or unrelated pre-existing staged changes, surface the concern and ask the user how to proceed. Otherwise, use the returned groups and messages unchanged for the confirmation plan.

5. **Show the plan and get one confirmation.** Call `ask_question` exactly once. Its `question` asks whether to commit the plan; its plain-text `details` contains the complete numbered plan in commit order, including every message and exact path:

   ```
   1. [message]
      ← file-a.ts, file-b.ts
   2. [message]
      ← docs/readme.md
   ```

   Include any non-blocking warning in the details. Never replace this plan with a generic summary. Offer confirmation, re-grouping, and message-editing as the options. A single confirmation covers the whole plan — don't ask per commit. This is the gate before any mutation.

6. **Commit each group in order.** For each group: `git add <exact paths for this group>` then `git commit -m "<message>"`. Stage precisely per group — **never `git add -A`** across groups, since precise staging is what keeps the commits separate.

7. **Push only if asked.** Pushing is outward-facing. If the user said "and push", confirm the remote/branch and run `git push`. If they didn't mention push, stop after committing and offer it — don't push unprompted.

8. **Report.** Show the result with `git log --oneline -n <number of commits made>`.

## Rules

- **Never bundle unrelated changes into one commit.** Honouring commit boundaries is the whole point of this skill over a blind `git add -A && git commit`.
- **Confirm before committing; confirm again before pushing.** One confirmation for the commit plan, a separate one for the push. Committing is reversible (`git reset`), pushing is not.
- **Delegate diff reading.** Filenames lie — a rename, a behaviour change, and a reformat look identical from outside. For non-empty working trees, only the mandatory `commit-planner` reads the working-tree snapshot; the parent presents its result or surfaces its warnings.
- **Guard what gets committed.** If a group would stage secrets, credentials, client data, or a large generated blob, stop and flag it rather than committing — surface it and ask. Respect `.gitignore` and any standing "don't commit X" instruction.
- **Leave pre-existing staged changes alone unless they're in scope.** If the index already holds unrelated staged files the user didn't mention, surface them and ask before folding them into a commit.

## Done means

The requested work is committed as one or more coherent commits, each message in the repo's existing convention, with no unrelated changes bundled together. A push happened only if the user explicitly asked for one. The new commits are shown via `git log --oneline`.
