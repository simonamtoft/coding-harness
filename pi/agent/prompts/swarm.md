# /swarm — Pi-native swarm workflow

Use this workflow when a task has independent slices that benefit from parallel coverage or same-brief races. It is a framing protocol over the `subagent` tool, not a workflow engine.

## Trigger and done predicate

Trigger only when the parent can state a bounded objective, a terminal done predicate, and the evidence required to judge it. The swarm is done when every required slice has a terminal `PASS`, `ISSUES`, or `BLOCKED` result and the parent has recorded aggregation, dropouts, and any merge/cleanup work. A worker's prose is not terminal evidence.

## Frame before dispatch

The parent writes one frame containing:

- objective, repository/head, and done predicate;
- required slices, allowed files/interfaces, and evidence expected;
- shape: `partition` (different slices), `race` (same brief, independent attempts), or `mixed`;
- declared race rule (for example, choose the first verified PASS, or compare all PASS results);
- standalone brief for every worker: context, exact assignment, constraints, cwd, verification command, and return format;
- ownership: parent owns resource allocation, aggregation, merge, and cleanup.

Read-only workers may share the checkout. A write slice may use only `implementation-worker`, must name a pre-created distinct absolute worktree/branch cwd, and must be preflighted before dispatch. The parent must record cwd/branch ownership and never ask a worker to create, merge, or clean resources.

Use existing read-only specialists when their contracts fit: `repository-scout`, `documentation-analyst`, `test-log-analyst`, `correctness-reviewer`, and `security-reviewer`. Runtime-discovered agents are not trusted by name alone; the subagent tool validates their source, frontmatter, purpose, tools, scope, and requested cwd.

## Dispatch and aggregation

Use `subagent` parallel for partition/race fan-out and chain only when a later brief explicitly needs the previous terminal output. Do not use generic fallback dispatch. If a required agent is unavailable, malformed, duplicated, improperly scoped, or drops out, record it as `BLOCKED` and do not silently substitute another role.

Aggregate by slice and preserve each worker's terminal evidence:

```text
SWARM PASS | objective: ...
required: slice-a PASS, slice-b PASS
races: rule ...; selected ...
verification: command -> exit status (per slice)
dropouts: none (or name, last state, reason)
merge/cleanup: parent-owned; status ...
```

`ISSUES` means the worker completed but found unresolved defects. `BLOCKED` means it could not safely perform the slice. The parent may fix or merge after aggregation, but must not relabel missing evidence as PASS.
