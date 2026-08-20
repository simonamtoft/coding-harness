---
name: present
description: Present substantive completed work as a self-contained HTML report by delegating report construction to an isolated Pi presenter agent. Use for final reports after implementations, investigations, reviews, or plans with enough content to benefit from a structured visual summary. Do not use for quick answers, clarifying questions, progress updates, or trivial changes.
---

# Present completed work through the presenter agent

Delegate report construction to the user-level `presenter` Pi subagent. Do not build the HTML report in the parent context.

## Prepare the delivery brief

Before invoking the subagent, assemble a concise but complete delivery brief from the current conversation and work performed. The subagent has an isolated context and cannot recover conversational decisions unless they are included explicitly.

Include:

- the report type: implementation, investigation, review, or plan
- the requested outcome and the actual conclusion
- key changes, findings, or decisions, including rationale that is not recoverable from files
- relevant absolute or repository-relative file paths and any trustworthy captures or source-derived evidence
- exact verification commands or probes run and their outcomes
- known limitations, unverified behavior, and follow-ups
- backlog tickets and dependencies only when they are part of the completed work

Distinguish observed facts from interpretation. Do not ask the presenter to infer the completed outcome solely from a Git diff. Keep the brief focused; omit raw conversation history and unrelated repository details.

## Delegate

Call the `subagent` tool in single-agent mode:

- `agent`: `presenter`
- `task`: ask it to create the final report and include the delivery brief
- `cwd`: the active repository or working directory
- `agentScope`: `user`

The presenter owns report ID generation, artifact assembly, validation, optional browser rendering, visual inspection, and final link formatting. It may inspect the repository to verify and enrich the supplied evidence, but the delivery brief remains the source for conversational conclusions and work performed outside the repository.

Do not invoke another report workflow in parallel. Do not edit the present skill, presenter instructions, templates, or report scripts as part of ordinary report generation.

## Deliver

Confirm the subagent returned a Markdown file link with an absolute `file://` path and that the target exists. If the target is missing or validation failed, ask the same presenter agent to repair its report before delivery.

The final response must contain only the presenter's Markdown link:

```markdown
[Open final report](file://<absolute-path>)
```

Do not include the HTML source, report body, summary, or other commentary.
