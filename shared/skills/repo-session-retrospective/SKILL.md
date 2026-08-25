---
name: repo-session-retrospective
disable-model-invocation: true
description: Use when the user explicitly asks to reflect on or retrospectively analyze the most recently completed agent session for the current repository. Produces an evidence-based, read-only temporary report of reusable improvements without editing guidance, skills, or Backlog.
---

# Repo session retrospective

Analyze the most recently completed session for the current repository and identify changes that would have prevented wrong turns or helped the agent reach the goal faster.

## Trigger and scope

Run only for an explicit reflect or retrospective request. Do not run automatically after a session, at a tool-count threshold, or as part of general transcript mining. Analyze one completed session for the current repository unless the user names a different session.

Use a transcript or session artifact supplied by the user or exposed to the current session by the harness. When the user does not identify a session, select the most recently completed session for the current repository from those available sources. Do not mine broader session history. If the source is unavailable or the selection is ambiguous, ask the user to provide or identify the session before analyzing it; do not substitute Git history or inferred events for transcript evidence.

Use one direct review by default. Parallel reviewers are optional only when the session is unusually long or complex and distinct review lenses would materially improve the result.

## Evidence and anti-overfitting

1. Reconstruct the relevant sequence: the initial approach, observable wrong turn or friction, correction, and outcome.
2. Cite transcript evidence for every finding with short quotes or precise message/tool references. If direct citation is unavailable, label the support **Evidence digest**, identify its source, and give a faithful factual summary. Never invent evidence.
3. Check existing skills, shared guidance, project guidance, scripts, lint rules, and runtime controls before recommending anything.
4. Classify each candidate lesson:
   - **Reusable lesson**: likely to recur and specific enough to prevent similar friction.
   - **One-off**: caused by incidental session context or unlikely to recur; reject it.
   - **Already covered**: an existing instruction or mechanism already addresses it; do not duplicate the rule. If the session ignored an existing rule, recommend stronger enforcement only when the evidence supports that change; otherwise choose no change.
5. Reject speculative lessons, generic advice, successful behavior that needs no change, and recommendations whose likely maintenance cost exceeds their demonstrated value.

## Route recommendations

Route every candidate recommendation to the narrowest suitable owner and explain why. Rejected candidates route to **No change**:

- **Skill** — a repeatable, named workflow that benefits from step-by-step guidance.
- **Project guidance** — a repository-specific convention or fact agents need while working here.
- **Shared guidance** — a durable rule that applies across repositories and tasks.
- **Script or lint** — a deterministic check or mechanical operation that tooling can perform reliably.
- **Runtime enforcement** — a safety or correctness invariant that must hold during execution and should not depend on remembering prose.
- **Backlog follow-up** — scoped implementation work that needs separate prioritization or design.
- **No change** — a one-off, already-covered behavior, weakly supported lesson, or issue not worth encoding.

Prefer reliable structural enforcement over prose when both are practical, but do not propose machinery for a problem that guidance can adequately solve.

## Report

Write a single, self-contained HTML page to `${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}/repo-session-retrospective.html` with these sections:

- **Session scope** — repository, session analyzed, and evidence availability.
- **Accepted recommendations** — for each: transcript citation or labelled evidence digest, reusable lesson, existing-coverage check, proposed change, owner, owner rationale, and expected benefit.
- **Rejected recommendations** — candidates routed to **No change** because they are one-off, already covered, speculative, or not worth changing, with evidence and rejection reason.
- **Follow-up** — unresolved questions and any work that could be proposed only after user approval. Do not create Backlog tasks.

This workflow is read-only except for the temporary HTML report. Do not edit project or shared instructions, skills, scripts, runtime configuration, or Backlog. Recommendations are proposals only. Explicit user approval is required in a later turn before making any instruction or skill edit or filing any follow-up task.

Do not include the report or any other commentary in the response. Output only a Markdown link in the form `[Open repo session retrospective](file://<absolute-path>)` so Pi renders it as a clickable terminal hyperlink.
