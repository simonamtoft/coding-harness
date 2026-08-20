---
name: generate-commit-message
description: Use when the user asks for a commit message for staged changes — "commit message?", "what's a good commit message", "propose a short commit message". If nothing is staged, offers to stage unstaged/untracked files first. Produces one focused line in the repo's existing style. Never runs `git commit`.
---

# Generate a commit message

Read what's actually staged, match the repo's commit-message style, and produce a single line the user can paste. Don't commit anything.

## When this triggers

- "commit message?"
- "What's a good commit message?"
- "Propose a small commit message"
- "Short commit message?"
- "Can you give me a short commit message"

## Procedure (in this order)

1. **Inspect what's staged.** Run `git diff --staged --stat` and `git diff --staged`.
   - If the staged set is **non-empty**, continue to step 2.
   - If the staged set is **empty**, run `git status --short` to show unstaged and untracked files. Present the list and ask the user which files to stage — offer "all", specific files, or "none / cancel". Wait for their answer before continuing.
     - If they choose files: run `git add <files>` for each, then continue to step 2.
     - If they choose none or cancel: stop here.
2. **Craft the message** by the shared rules in `~/.claude/skills/_shared/commit-message-rules.md` — repo-style detection (the two scripts) plus the one-line format.
3. **If the diff spans unrelated changes,** don't write a portmanteau. Say so and suggest a split (e.g. "this looks like two changes — A and B — consider `git restore --staged` for one of them"). Only continue if the user confirms they want a single message anyway. To actually commit such a split, that's `/quick-commit`.
4. **Output as a single fenced block** so the user can copy-paste. No preamble, no surrounding commentary.

## Rules

- **Never run `git commit`** — produce the message only. To stage-and-commit, use `/quick-commit`.
- Message-crafting rules (style match, imperative, ≤72 chars, no emoji/`Co-Authored-By`, what-not-why, no path-restating, no padding) live in `~/.claude/skills/_shared/commit-message-rules.md`.

## Done means

A single commit-message line is on screen in a fenced block, matching the repo's existing convention. Files may have been staged at the user's explicit request. Nothing has been committed.
