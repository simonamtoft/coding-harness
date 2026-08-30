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
- key changes, findings, decisions, and non-file-based rationale
- relevant paths and trustworthy captures or source-derived evidence
- verification commands or probes, with passed, failed, or unavailable status; counts only when material
- limitations, unverified behavior, and follow-ups
- Backlog tickets or dependencies only when needed to understand the work

Distinguish fact from interpretation. Do not make the presenter infer the outcome from a Git diff or raw conversation history.

## Delegate

Dispatch exactly one user-level `presenter` subagent; do not build the report in the parent context or run another report workflow.

- **Pi:** `agent: presenter`, a task containing the delivery brief, `cwd` set to the active repository, and `agentScope: user`.
- **Claude Code:** `subagent_type: presenter`, a prompt containing the delivery brief and intended working directory.

The presenter owns report IDs, assembly, validation, optional rendering and inspection, and final link formatting. It may inspect the repository to enrich supplied evidence. Do not edit this skill, its presenter instructions, templates, or scripts during ordinary report generation.

## Deliver

Confirm the presenter returned an absolute `file://` Markdown link and that the target exists. If it is missing or validation failed, ask the same presenter to repair it.

Return only:

```markdown
[Open final report](file://<absolute-path>)
```
