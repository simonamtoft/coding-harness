---
name: repo-session-retrospective
disable-model-invocation: true
description: Use only when the user explicitly asks to reflect on or retrospectively analyze a completed agent session. Produces an evidence-based, read-only HTML report of durable repository improvements.
---

# Repo session retrospective

Find changes that would have prevented wrong turns or helped the agent finish faster.

## Scope

Analyze one completed session for the current repository unless the user names another. Use a transcript or session artifact supplied by the user or exposed by the harness. If no session is named, select the most recently completed one for this repository. If the source is unavailable or ambiguous, ask the user to provide or identify it, then stop without writing a report. Do not mine broader session history or substitute Git history for transcript evidence.

Use one direct review by default. Parallel reviewers are optional only for unusually long or complex sessions where distinct review lenses would materially help.

## Procedure

1. Reconstruct each relevant sequence: initial approach, wrong turn or friction, correction, and outcome.
2. Support every candidate with short transcript quotes or precise message/tool references. If direct citation is unavailable but the source supports a factual summary, label it **Evidence digest** and identify the source. Never invent evidence.
3. Check existing skills, shared and project guidance, scripts, lint rules, and runtime controls.
4. Give each candidate exactly one disposition by applying this list in order:
   - **Unsupported**: the evidence does not establish a problem or lesson. Route to **No change**.
   - **One-off**: the issue depended on incidental context or is unlikely to recur. Route to **No change**.
   - **Already covered**: an adequate instruction or mechanism exists. Route to **No change**. If repeated failures show that prose is inadequate, continue instead and consider enforcement.
   - **Not worth encoding**: likely maintenance cost exceeds the demonstrated benefit. Route to **No change**.
   - **Accepted reusable lesson**: the issue is likely to recur, well supported, and actionable. Route it below.
5. Route each accepted lesson to the first suitable owner:
   - **Backlog follow-up** when further design or prioritization is needed before a concrete change can be chosen.
   - **Script or lint** for a deterministic check or mechanical operation.
   - **Runtime enforcement** for an execution-time invariant that must not depend on remembered prose.
   - **Skill** for a repeatable, named, multi-step workflow.
   - **Project guidance** for repository-specific knowledge or rules.
   - **Shared guidance** for knowledge or rules that apply across repositories.

Use the narrowest owner. Prefer reliable enforcement over prose, but do not add machinery when guidance is adequate.

## Report and output

Write one self-contained HTML page to `${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}/repo-session-retrospective.html` with:

- **Session scope**: repository, session, source, and evidence availability.
- **Accepted recommendations**: evidence, existing-coverage check, proposed change, owner and rationale, and expected benefit.
- **Rejected recommendations**: evidence, disposition, rejection reason, and **No change** route.
- **Follow-up**: unresolved questions and approval-gated work. Do not create Backlog tasks.

The workflow is read-only except for the temporary report. Do not edit guidance, skills, scripts, runtime configuration, or Backlog. Explicit user approval is required in a later turn before editing instructions or skills or filing a follow-up task.

After a successful analysis, respond only with `[Open repo session retrospective](file://<absolute-path>)` so Pi renders a clickable terminal link.
