# Why mode

Code shape is not evidence of its own motivation. Anchor the target in current code, then search the rationale record that is actually available:

- `git blame`, file history through renames, commits, and merge messages;
- pull-request descriptions, reviews, and linked issues when repository remotes and credentials make them accessible;
- Backlog tasks, ADRs, design documents, README or runbook material, tests, and code comments;
- other repository-configured evidence sources relevant to the target.

Search by symbols, paths, old names, commit IDs, task or issue IDs, and domain terms. Follow links between sources rather than treating the newest commit as the whole history.

Report rationale using distinct sections:

- **Direct evidence:** explicit statements of intent or constraint, each cited.
- **Reasonable inference:** evidence chain and calibrated wording such as “likely” or “suggests.”
- **Contradictions:** sources that disagree or describe different points in time.
- **Unknowns and unavailable sources:** searches with no result, inaccessible PRs or systems, and questions the record does not answer.

If direct evidence is absent, say so. Current code can support an explanation of mechanics but cannot by itself prove why a decision was made.
