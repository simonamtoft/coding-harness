---
name: handoff
disable-model-invocation: true
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: What will the next session be used for?
---

# Handoff

Write a handoff document so a fresh agent can continue the work without needing to re-read this conversation. Save it to the OS temp dir, never to the workspace.

## When this triggers

- "/handoff"
- "Write a handoff doc"
- "Create a handoff"
- "Summarise this session for the next agent"
- "Compact this conversation for handoff"

## Procedure (in this order)

1. **Determine focus.** If the user passed arguments, treat them as a description of what the next session will focus on. Let that scope guide what to include and what to omit.

2. **Identify existing artifacts.** Scan the conversation for references to files, plans, PRDs, ADRs, GitHub issues, PRs, or commits that already capture content. Do not re-summarise their content — reference them by path or URL instead.

3. **Draft the document.** Structure it as follows:

   ```
   # Handoff — <short title>

   **Date:** <today>
   **Next session focus:** <from args, or inferred from conversation>

   ## Context

   One short paragraph: what problem is being solved and why. No implementation detail here.

   ## Current state

   Bullet list: what is done, what is in-progress, what is blocked. One line per item.

   ## Key decisions

   Bullet list of non-obvious decisions made and the reason behind each. Skip decisions that are self-evident from the code.

   ## Open questions / known risks

   Bullet list of unresolved questions or risks the next agent should know about. If none, omit the section.

   ## Artifacts

   Bullet list of paths or URLs to plans, PRDs, ADRs, issues, PRs, diffs, or other documents that contain the detail. Format: `- [label](path-or-url) — one-line description of what's there`.

   ## Suggested skills

   Bullet list of skills the next agent should consider invoking. Pick from the skills available in `~/.claude/skills/`. Only list skills that are genuinely relevant to the next session's focus.
   Format: `- \`/skill-name\` — why it's relevant`.

   ## How to resume

   2–4 concrete steps the next agent should take to get oriented and unblock. Reference artifact paths where relevant.
   ```

4. **Redact sensitive data.** Before writing the file, scan for API keys, tokens, passwords, secrets, and personally identifiable information beyond the user's name. Replace each with `[REDACTED]`.

5. **Write the file.** Save to `$TMPDIR` (macOS) or `/tmp` (Linux). Name it `handoff-<YYYY-MM-DD>-<slug>.md` where `<slug>` is a 2–3-word kebab-case summary of the topic. Print the full path when done.

## Rules

- **Save to `$TMPDIR`, not the workspace.** Never write inside the current project directory.
- **Reference artifacts, don't duplicate them.** If a plan file captures the implementation steps, just link it. Don't copy its content into the handoff.
- **Tailored to Simon.** The document is for the maintainer continuing his own work. Write in second person ("you left off at…", "your next step is…"). Don't explain things Simon already knows about his own project.
- **No padding.** If a section has nothing real to say, omit it. A short accurate document beats a long padded one.
- **Redact before write.** Never write sensitive data to disk even temporarily.
- **Skills section is curated, not exhaustive.** List 2–4 genuinely relevant skills. Don't list every skill that vaguely applies.

## Done means

A `.md` file exists in `$TMPDIR`, its full path is printed on screen, and the document is ready to paste or attach to a new session.
