# Subagent extension

This extension owns Pi's `subagent` and `review_changes` runtime behavior: agent discovery, frontmatter validation, capability restrictions, project-agent trust, isolated subprocess execution, swarm support, and review dispatch.

## Change rules

- Preserve the parent-owned orchestration model. The extension may validate and execute a bounded delegation, but it must not become a registry, scheduler, coordinator, worktree manager, or generic fallback worker.
- Treat capability changes, discovery scope, model precedence, project-agent confirmation, cwd validation, and review lifecycle changes as security- and behavior-sensitive. Keep the enforced rules in `agents.ts`, the tool schema and runtime in `index.ts`, and the user-facing contract in `README.md` consistent.
- New ordinary agent roles are read-only. Only the explicitly recognized `implementation-worker` may write, and only in a coordinator-provided distinct absolute worktree. Do not weaken project-agent trust or subprocess extension isolation without an explicit requirement.
- Add or update focused tests beside this extension; never place test files at `pi/agent/extensions/` root because Pi auto-loads root TypeScript files.
- Read `../../../../decisions/subagents.md` before changing delegation or review behavior and `../../../../decisions/extensions.md` before changing extension layout or loading behavior.

Verify changes with:

```sh
bun test pi/agent/extensions
```
