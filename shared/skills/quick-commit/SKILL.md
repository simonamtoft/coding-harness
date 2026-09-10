---
name: quick-commit
description: Use when the user wants changes actually committed — "quick commit", "commit this", "commit these changes", or "commit and push". Groups the working tree into coherent commits, confirms the plan once, and commits it.
---

# Quick commit

Turn the current working tree into one or more coherent commits. This is the committing counterpart to `generate-commit-message`, which only proposes a message. Never bundle unrelated changes merely to make one commit.

## When this triggers

- "quick commit"
- "commit this" / "commit these changes"
- "commit and push"
- "commit what we've got" / "just commit it"

## Procedure

1. **Capture the private snapshot.** Resolve `scripts/capture_snapshot.sh` relative to this skill directory and invoke it once. **Pi:** pass `$PI_SESSION_TMPDIR` as its first argument. **Claude Code:** pass its private session workspace when available. Pass the user's stated commit scope as the optional second argument, quoted as one argument.

   The helper creates a mode-0700 snapshot directory, captures status exactly once, and returns either `EMPTY` or the absolute path of an evidence file. It includes staged and unstaged diffs, message-style evidence, and recursively enumerated nonignored untracked files. It marks unreadable, nonregular, and binary untracked paths as uncaptured. Do not recreate this capture logic in shell, inspect the evidence yourself, or print it into the parent context.

   If it returns `EMPTY`, report that there is no work and stop. Otherwise retain the returned evidence path until the user accepts the final plan or cancels.

2. **Delegate commit planning.** Dispatch exactly one cheap, read-only `commit-planner` with only the evidence file's absolute path. The planner is the sole reader of working-tree evidence and follows `COMMIT-PLANNER.md`. It returns either a ready plan or a blocking clarification.

   - **Pi:** invoke `subagent` with `agent: commit-planner`, `agentScope: user`, and `cwd` set to the snapshot directory (the parent directory of the evidence file).
   - **Claude Code:** invoke `Task` with `subagent_type: commit-planner`, supplying the evidence path and active working directory.

3. **Resolve planner clarifications.** Do not read the evidence to second-guess the planner or silently fold material into a group.

   - For a blocking clarification, call `ask_question` exactly once with the planner's `question`, plain-text `details`, and up to three labelled options.
   - If the user chooses manual hunk staging, remove the snapshot directory in a separate cleanup command, tell them to use `git add -p -- <path>` with their normal index-isolation workflow, and stop without mutation.
   - For any other answer or requested revision, re-dispatch the planner with the answer and same evidence. Repeat only for an independent unresolved issue.

4. **Show the ready-plan decision.** Call `ask_question` exactly once for each ready plan. Ask whether to commit it. Its plain-text details must contain every group in order, each message, and every exact path:

   ```text
   1. [message]
      ← file-a.ts, file-b.ts
   2. [message]
      ← docs/readme.md
   ```

   Include all warnings: mixed-concern files, possible secrets, credentials, client data, generated material, uncaptured or nonregular paths, and unrelated pre-existing staged changes. Offer **Commit this plan**, **Re-group or edit messages**, and **Cancel**. A positive confirmation covers the entire plan.

5. **Commit the accepted groups.** Remove the snapshot directory in a separate cleanup command using the resolved parent directory of the evidence file. For each full-file group, in order, run:

   ```bash
   git add -- <exact paths for this group>
   git commit --only -m "<message>" -- <exact paths for this group>
   ```

   `--only` excludes unrelated pre-existing index entries. Never use `git add -A` across groups.

6. **Push only when requested.** If the user said "and push", separately confirm the remote and branch before `git push`. Otherwise stop after committing; do not push unprompted.

7. **Report.** Show `git log --oneline -n <number of commits made>`.

## Rules

- Never bundle unrelated changes into one commit.
- Confirm before committing and again before pushing.
- The planner alone reads and analyzes working-tree evidence; the parent owns confirmation and Git mutations.
- Stop and flag possible secrets, credentials, client data, or large generated blobs rather than committing them automatically.
- Respect `.gitignore` and standing instructions about material that must not be committed.
- Leave pre-existing staged changes outside scope alone; surface them and use `git commit --only -- <paths>`.

## Done means

The requested work is committed as one or more coherent commits, each in the repository's existing message convention, without unrelated changes. A push happens only after the user explicitly requested and confirmed it.
