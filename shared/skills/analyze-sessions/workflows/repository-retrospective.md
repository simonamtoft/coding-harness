# Repository retrospective

Find changes that would have prevented wrong turns or helped the agent finish faster.

## Scope

Analyze one completed session for the current repository unless the user names another. Use a transcript or session artifact supplied by the user or exposed by the harness. If no session is named, select the most recently completed one for this repository. If the source is unavailable or ambiguous, ask the user to provide or identify it, then stop without writing a report. Do not mine broader session history or substitute Git history for transcript evidence.

Use one direct review by default. Parallel reviewers are optional only for unusually long or complex sessions where distinct review lenses would materially help.

## Procedure

1. Reconstruct each relevant sequence: initial approach, wrong turn or friction, correction, and outcome.
2. Support every candidate with short transcript quotes or precise message/tool references. If direct citation is unavailable but the source supports a factual summary, label it **Evidence digest** and identify the source. Never invent evidence.
3. Check existing skills, shared and project guidance, scripts, lint rules, and runtime controls.
4. Give each candidate exactly one disposition in this order:
   - **Unsupported**, **One-off**, **Already covered**, or **Not worth encoding**: route to **No change**.
   - **Accepted reusable lesson**: route it below.
5. Route each accepted lesson to the first suitable owner: **Backlog follow-up**, **Script or lint**, **Runtime enforcement**, **Skill**, **Project guidance**, or **Shared guidance**. Use the narrowest owner and prefer reliable enforcement over prose.
6. Route separately to the repository's decision ledger, if it maintains one, any approach the session rejected or reversed and any rationale the resulting code does not carry. A ledger entry records why a direction was refused; it does not replace an owner for lessons that need enforcement.

## Report and output

Write one self-contained HTML page to `${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}/repo-session-retrospective.html` with:

- **Session scope**: repository, session, source, and evidence availability.
- **Accepted recommendations**: evidence, coverage check, proposed change, owner and rationale, and expected benefit.
- **Rejected recommendations**: evidence, disposition, rejection reason, and **No change** route.
- **Follow-up**: unresolved questions and approval-gated work. Do not create Backlog tasks.

The workflow is read-only except for the temporary report. Explicit user approval in a later turn is required before editing instructions or skills or filing a follow-up task.

After a successful analysis, respond only with `[Open repo session retrospective](file://<absolute-path>)` so Pi renders a clickable terminal link.
