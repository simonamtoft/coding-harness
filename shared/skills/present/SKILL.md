---
name: present
disable-model-invocation: true
description: Present substantial completed work as a self-contained HTML report by delegating report construction to an isolated presenter subagent. Use only when the work is substantial and a structured report communicates the outcome better than the primary artifact or UI. Do not use when the result is easy to verify directly in the UI, or for quick answers, clarifying questions, progress updates, routine changes, or trivial changes.
---

# Present completed work through the presenter agent

Use this skill only when the work is substantial **and** an HTML report explains it better than the primary artifact, UI, or concise Markdown. Otherwise respond in concise Markdown.

## Prepare the delivery brief

Give the isolated presenter a focused, source-of-truth brief containing:

- report type: implementation, investigation, review, or plan
- requested outcome and actual conclusion
- the changes a reader must see, each with its before and after: paths, the commit or base revision to diff, and changed call orders, workflows, or dependencies
- screenshots or exact output captured before and after the change, with absolute paths, and how to serve the app if a capture is still needed
- decisions and rationale that are not in the files
- verification commands or probes, with passed, failed, or unavailable status; counts only when material
- limitations, unverified behavior, and follow-ups
- Backlog tickets or dependencies only when needed to understand the work

Distinguish fact from interpretation. Do not make the presenter infer the outcome from a Git diff or raw conversation history.

## Delegate

Dispatch exactly one user-level `presenter` subagent; do not build the report in the parent context or run another report workflow.

- **Pi:** `agent: presenter`, a task containing the delivery brief, `cwd` set to the active repository, and `agentScope: user`.
- **Claude Code:** `subagent_type: presenter`, a prompt containing the delivery brief and intended working directory.

The presenter owns report IDs, the report spec, captures it can take itself, building, validation, visual inspection, and final link formatting. The report is mostly visual, with at most one short line of text per change. It may inspect the repository to enrich supplied evidence. Do not edit this skill, its presenter instructions, templates, or scripts during ordinary report generation.

## Deliver

Confirm the presenter returned an absolute `file://` Markdown link and that the target exists. If it is missing or validation failed, ask the same presenter to repair it.

Return only:

```markdown
[Open final report](file://<absolute-path>)
```
