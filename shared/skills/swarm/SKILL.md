---
name: swarm
description: Coordinate bounded parallel or racing subagent work with explicit framing, terminal evidence, and parent-owned aggregation. Use when independent slices benefit from parallel coverage or same-brief comparison.
---

# Swarm

Use this workflow only when the parent can state a bounded objective, a terminal done predicate, and the evidence required to judge each slice. A swarm is a framing protocol over the active harness's subagent mechanism, not a workflow engine.

## Frame before dispatch

Write one frame containing:

- objective, repository/head, and done predicate;
- required slices, allowed files or interfaces, and expected evidence;
- shape: `partition` for different slices, `race` for independent attempts at the same brief, or `mixed`;
- the race rule, such as first verified pass or comparison of every passing result;
- a standalone brief for every worker: context, exact assignment, constraints, working directory, verification command, and return format;
- ownership: the parent owns resource allocation, aggregation, merge, and cleanup;
- dropout policy: unavailable or incomplete required slices remain `BLOCKED` rather than being silently substituted or treated as passing.

Read-only workers may share a checkout. Writable workers require distinct pre-created worktrees and branches with explicit absolute working directories. Workers must not create, merge, or remove those resources.

## Dispatch

Use parallel dispatch for partitions and races. Use a chain only when a later brief explicitly requires the previous worker's terminal output.

- **Pi:** use `subagent`. Existing read-only specialists include `repository-scout`, `documentation-analyst`, `test-log-analyst`, `correctness-reviewer`, and `security-reviewer`. Writable slices use only `implementation-worker`, with its worktree passed as `cwd`. Runtime-discovered agents are not trusted by name alone; project-local agents require interactive approval or an explicit trusted headless opt-out.
- **Claude Code:** use `Task` with the narrowest suitable read-only or writable subagent type available in that session. Give writable workers separate pre-created worktrees and explicit working directories; do not let multiple workers edit one checkout.

Do not use a generic fallback when a required role is unavailable or invalid. Record that slice as `BLOCKED`.

## Aggregate

The parent judges the evidence and preserves every worker's terminal state:

```text
SWARM PASS | objective: ...
required: slice-a PASS, slice-b PASS
races: rule ...; selected ...
verification: command -> exit status (per slice)
dropouts: none (or name, last state, reason)
merge/cleanup: parent-owned; status ...
```

Allowed terminal states:

- `PASS`: the slice met its done predicate with the required evidence.
- `ISSUES`: the worker completed but found unresolved defects.
- `BLOCKED`: the worker could not safely complete the slice.

A worker's prose alone is not terminal evidence. The parent may fix or merge after aggregation, but must not relabel missing evidence as `PASS`.

## Non-goals

This skill is not a registry, scheduler, workflow engine, worktree factory, port manager, verifier, race judge, or persistent orchestration layer.
