---
name: write-pr-description
disable-model-invocation: true
description: Use when the user asks to write or fill out a pull-request description — "write a PR description", "fill out the template", "suggest text for the main comment". Uses the repo's actual PR template, summarizes the branch's commits, and outputs markdown the user can paste. Never opens or edits the PR itself.
---

# Write a PR description

Produce the PR body the user will paste into GitHub (or copy into `gh pr create`). Use the repo's real template, the branch's actual commits, and the linked ticket. Don't open or edit any PR.

## When this triggers

- "Please write a PR description"
- "Fill out the PR template"
- "Can you suggest text for the main comment?"
- "Help me write the PR body"

## Procedure (in this order)

1. **Find the PR template.** Resolve `scripts/find_pr_template.sh` from this skill directory and run it. If output is a path, read that file as the template. If output is `NONE`, use a minimal `## Summary` / `## Test plan` shape and say "no template found, using minimal shape".
2. **Establish the base branch.** Resolve `../_shared/scripts/git_base_branch.sh` from this skill directory and run it. Use its stdout as `<base>`. If the script exits 1, ask the user to name the base branch.
3. **Read the actual branch contents.** `git log <base>..HEAD --reverse --format=%s%n%b` and `git diff <base>..HEAD --stat`. Read the diff stat — don't pull the full diff unless a section explicitly demands it (e.g. "Breaking changes").
4. **Extract the ticket key.** Resolve `../_shared/scripts/git_ticket_key.sh` from this skill directory and run it. Use its stdout as the ticket reference; if empty, check commit subjects for a key. Include it where the template wants it; don't sprinkle it.
5. **Fill each template section concretely.**
   - **Summary** — 1–3 bullets, the *what* and *why*, not a commit-log dump. Group related commits into a single bullet.
   - **Test plan / verification** — concrete checks tied to what changed (commands to run, screens to look at). Don't list aspirational ones.
   - **Risk / out-of-scope / breaking changes** — only if the template asks AND there's something real to say. Otherwise note "n/a" rather than padding.
   - **Screenshots / videos** — leave a placeholder only if the diff actually touches UI; otherwise drop the section.
6. **Output as a single fenced markdown block.** No preamble, no "here's your description". The user copies it directly.

## Rules

- **Never run `gh pr create` or `gh pr edit`** unless the user explicitly asks. This skill produces text only.
- **Use the repo's actual template** — don't invent or override one if it exists. If the template is unusual (custom headings, HTML comments with instructions), preserve its structure.
- **Skip empty sections rather than padding.** A "Migration notes" header followed by "N/A — no schema changes" is fine; a paragraph of filler is not.
- **No commit hashes, no diff hunks, no file lists** in the description. The PR page shows those.
- **One ticket reference, not five.** Place it where the template wants it.
- **Don't pre-check checkboxes** in the template. The author checks them after verifying.

## Done means

A PR description body, in markdown, in a single fenced block on screen — ready to paste. No PR has been opened, edited, or commented on.
