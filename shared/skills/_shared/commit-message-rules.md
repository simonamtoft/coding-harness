# Commit message rules

Single source for how a commit message is crafted. Shared by `generate-commit-message`
(proposes one line, never commits) and `quick-commit` (stages and commits). When a message
is written in either skill, these rules apply.

## Match the repo's style

Detect once, then mirror what the repo already does — never introduce a convention it doesn't use:

- `~/.claude/skills/generate-commit-message/scripts/detect_commit_style.sh` → `conventional` | `ticket-prefixed` | `plain`.
- `~/.claude/skills/_shared/scripts/git_ticket_key.sh` → a ticket key from the branch name. Prepend it **only** when the detected style is `ticket-prefixed`; otherwise drop it.

## Write the line

- **Imperative mood** — "Add", "Fix", "Refactor" (not "Added" / "Adds").
- **≤72 characters**, no trailing period.
- **Never add a `Co-Authored-By` trailer or `🤖` attribution line** — no exceptions, even if asked.
- **No emoji** unless the user explicitly asks.
- Describe the **what**, at the level of the diff — not the why, not the implementation detail.
- **Read the diff before writing.** A rename, a behaviour change, and a reformat look identical from filenames alone.
- **Don't restate file paths** the reader can see in `git show`, and **don't pad** ("this PR", "we now", "various changes"). A one-line diff gets one short clause.
