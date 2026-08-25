---
name: swarm
description: Coordinate bounded Pi-native parallel or racing subagent work with explicit framing and parent-owned aggregation
---

# Swarm

Use the Pi `/swarm` prompt as a thin protocol over `subagent`. It supports partitioned coverage, same-brief races, and mixed shapes without importing Cursor cloud, model-role, todo, or automatic worktree assumptions.

The parent must define the objective, done predicate, required slices, shape, race rule, standalone briefs, terminal evidence, and dropout policy before dispatch. Read-only slices may share a checkout. Writable slices use only `implementation-worker` and require distinct pre-created worktrees/branches and explicit cwd values. The parent retains resource, merge, and cleanup ownership.

This is deliberately not a registry, scheduler, workflow engine, worktree factory, port manager, verifier, race judge, or persistent orchestration layer. Runtime discovery is validated by the Pi subagent extension; project-local agents require interactive approval or an explicit trusted headless opt-out.
