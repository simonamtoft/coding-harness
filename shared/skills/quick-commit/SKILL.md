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

1. **Create a private working-tree snapshot.** First use direct `read` calls to load `../_shared/commit-message-rules.md`, `../generate-commit-message/scripts/detect_commit_style.sh`, and `../_shared/scripts/git_ticket_key.sh` from this skill directory. This is static skill material, not working-tree evidence. Copy the rules to a mode-0600 file and the helper scripts to mode-0700 files inside the snapshot directory. **Never name an installed skill path in Bash.**

   Create a mode-0700 snapshot directory in the harness's private session workspace. **Pi:** use `$PI_SESSION_TMPDIR` exactly; do not fall back to `$TMPDIR` or `/tmp`. **Claude Code:** use its private session workspace when available. Capture `git status --short` exactly once in a separate mode-0600 regular file. Test that file with `-s`—never test command or process-substitution output directly. If it is empty, remove the directory in a separate cleanup command using its resolved absolute path, report no work, and stop.

   Otherwise, write any user-stated scope, the captured status file's contents, `git diff` (unstaged), and `git diff --staged` to a mode-0600 snapshot file. Append the copied rules, the output of the copied style-detector and ticket-key helpers, and `git log -10 --format=%s`. Enumerate nonignored untracked files with `git ls-files --others --exclude-standard -z`, not `git status --short`: its NUL-delimited entries include files nested under an untracked directory. For every enumerated file, include its type and byte size; include each readable, regular, nonbinary file’s contents as a diff against an empty temporary file. When appending that diff, treat exit statuses 0 and 1 as successful and propagate any higher status. Mark only unreadable, nonregular, or binary files whose contents cannot be captured as requiring a warning and exclusion from automatic staging. Do **not** read the snapshot or emit the diff into the parent context. The command may report only whether the captured status file is empty.

2. **Delegate all diff analysis.** Dispatch exactly one cheap, read-only `commit-planner` subagent with the snapshot's absolute path — never put the full diff in the delegation prompt. The planner is the sole reader of the working-tree evidence. It returns either a ready commit plan or a blocking clarification. Retain the directory until the user accepts the final plan or cancels; the parent retains all staging, committing, pushing, and user confirmation.

   - **Pi:** invoke `subagent` with `agent: commit-planner`, `agentScope: user`, and `cwd` set to the snapshot directory, so its read-only tools can access the snapshot. The task contains only its filename and the requested output.
   - **Claude Code:** invoke `Task` with `subagent_type: commit-planner` and a prompt containing the snapshot path, requested output, and active working directory.

3. **Resolve a blocking clarification or requested revision.** Do not read the snapshot to second-guess the planner or silently fold material into a group.

   - **Blocking clarification:** call `ask_question` exactly once with the planner's `question`, plain-text `details`, and up to three labelled options. The details show the safe groups, proposed messages, and specific ambiguity.
   - **Manual-hunk option:** remove the snapshot directory with a separate cleanup command using its resolved absolute path, tell the user to split the file with `git add -p -- <path>` and their normal index-isolation workflow, and stop without mutation.
   - **Any other answer or ready-plan revision:** re-dispatch the planner with the answer and same snapshot. Repeat while the planner returns an independent blocking clarification or the user changes the plan. Present a commit decision only after it returns ready.

4. **Show one ready-plan decision gate.** Call `ask_question` exactly once for each ready plan. Its question asks whether to commit the plan; its plain-text details contains the complete numbered plan in commit order, including every message and exact path:

   ```
   1. [message]
      ← file-a.ts, file-b.ts
   2. [message]
      ← docs/readme.md
   ```

   Include every non-blocking warning—mixed-concern files, possible secrets, credentials, client data, generated material, uncaptured or nonregular untracked paths, and unrelated pre-existing staged changes—in these details. Never replace this plan with a generic summary. Offer **Commit this plan**, **Re-group or edit messages**, and **Cancel**. A single positive confirmation covers the whole plan; a revision re-dispatches the planner under step 3, and cancellation removes the snapshot directory without mutating the repository.

5. **Commit each full-file group in order.** After a positive confirmation, remove the snapshot directory with a separate cleanup command using its resolved absolute path. For each group, run `git add -- <exact paths for this group>`, then `git commit --only -m "<message>" -- <exact paths for this group>`. `--only` is required: it excludes unrelated pre-existing index entries from the commit. Never use `git add -A` across groups.

6. **Push only if asked.** Pushing is outward-facing. If the user said "and push", confirm the remote/branch and run `git push`. If they didn't mention push, stop after committing and offer it — don't push unprompted.

7. **Report.** Show the result with `git log --oneline -n <number of commits made>`.

## Rules

- **Never bundle unrelated changes into one commit.** Honouring commit boundaries is the whole point of this skill over a blind `git add -A && git commit`.
- **Confirm before committing; confirm again before pushing.** One ready-plan decision covers warnings and the commit plan; a separate confirmation covers the push. Committing is reversible (`git reset`), pushing is not.
- **Delegate diff reading.** Filenames lie — a rename, a behaviour change, and a reformat look identical from outside. For non-empty working trees, only the mandatory `commit-planner` reads the working-tree snapshot; the parent presents its result or surfaces its warnings.
- **Guard what gets committed.** If a group would stage secrets, credentials, client data, or a large generated blob, stop and flag it rather than committing — surface it and ask. Respect `.gitignore` and any standing "don't commit X" instruction.
- **Leave pre-existing staged changes alone unless they're in scope.** Surface unrelated index entries in the ready-plan decision, and use `git commit --only -- <paths>` so they cannot enter a requested commit.

## Done means

The requested work is committed as one or more coherent commits, each message in the repo's existing convention, with no unrelated changes bundled together. A push happened only if the user explicitly asked for one. The new commits are shown via `git log --oneline`.
