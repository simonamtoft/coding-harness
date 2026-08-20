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

1. **See the whole working tree.** Run `git status --short`, `git diff` (unstaged), and `git diff --staged`. Read the actual diffs, not just filenames — a rename, a behaviour change, and a reformat look identical from the outside, and the grouping in step 2 depends on what really changed.

2. **Group changes into coherent commits.** Partition the changed files into the smallest set of groups where each group is *one* logical change (a feature, a fix, a refactor, a docs update, a config tweak). Most trees are a single group — that's the fast path, one commit. When changes span unrelated concerns, split them: each concern is its own commit. If a *single file* mixes concerns, stage it by hunk (`git add -p`) or flag it and ask how to split — don't silently lump.

3. **Draft one message per group** by the shared rules in `~/.claude/skills/_shared/commit-message-rules.md` — repo-style detection (the two scripts) plus the one-line format, applied to each group independently.

4. **Show the plan and get one confirmation.** Present a numbered list, in commit order, each entry showing its files and its message:

   ```
   1. [message]   ← file-a.ts, file-b.ts
   2. [message]   ← docs/readme.md
   ```

   Ask the user to confirm, re-group, or edit any message. A single confirmation covers the whole plan — don't ask per commit. This is the gate before any mutation.

5. **Commit each group in order.** For each group: `git add <exact paths for this group>` then `git commit -m "<message>"`. Stage precisely per group — **never `git add -A`** across groups, since precise staging is what keeps the commits separate.

6. **Push only if asked.** Pushing is outward-facing. If the user said "and push", confirm the remote/branch and run `git push`. If they didn't mention push, stop after committing and offer it — don't push unprompted.

7. **Report.** Show the result with `git log --oneline -n <number of commits made>`.

## Rules

- **Never bundle unrelated changes into one commit.** Honouring commit boundaries is the whole point of this skill over a blind `git add -A && git commit`.
- **Confirm before committing; confirm again before pushing.** One confirmation for the commit plan, a separate one for the push. Committing is reversible (`git reset`), pushing is not.
- **Read the diff before grouping.** Filenames lie — a rename, a behaviour change, and a reformat look identical from outside.
- **Guard what gets committed.** If a group would stage secrets, credentials, client data, or a large generated blob, stop and flag it rather than committing — surface it and ask. Respect `.gitignore` and any standing "don't commit X" instruction.
- **Leave pre-existing staged changes alone unless they're in scope.** If the index already holds unrelated staged files the user didn't mention, surface them and ask before folding them into a commit.

## Done means

The requested work is committed as one or more coherent commits, each message in the repo's existing convention, with no unrelated changes bundled together. A push happened only if the user explicitly asked for one. The new commits are shown via `git log --oneline`.
