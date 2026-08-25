# Repository operating context

This repository is the canonical, version-controlled source for the user's Pi and Claude coding-agent setup. `link.sh` deploys it into each harness's native directory; credentials and runtime state remain local. `README.md` is the human setup guide and design explanation. Keep this file to agent-facing operating constraints.

## Ownership and constraints

- `shared/AGENTS.md` and `shared/skills/` are only for behavior one implementation can serve to both harnesses. Keep divergent formats and capabilities in their harness directory; do not duplicate shared resources there.
- `pi/agent/` owns Pi-only instructions, agents, extensions, prompts, MCP configuration, and the package manifest.
- `claude/` owns Claude-only agents, hooks, settings, statusline, and themes.
- Root `AGENTS.md` applies only in this repository. Preserve its generated Backlog instruction block.
- Edit canonical sources here, never their installed paths under `~/.pi` or `~/.claude`.
- `link.sh` defines link topology and Pi package installation. Preserve its refusal and backup behavior for existing targets.
- Do not commit credentials, authentication state, provider/model configuration, sessions, caches, installed packages, generated state, or local `~/.pi/agent/settings.json`, `models.json`, and `subagents.json`.
- Update `README.md` with changes to link behavior, layout, installation, or ownership boundaries.

## Verification

Run checks for the changed component:

- Link script syntax: `bash -n link.sh`
- Pi extensions: `bun test pi/agent/extensions`
- Claude Bash guard: `bash claude/hooks/test/run.sh`
- Claude verify hook: `bash claude/hooks/test/verify-turn-run.sh`

For link-topology changes, exercise `link.sh` with an isolated temporary `HOME`; never test a forced install against the real home directory.

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.50.1 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

### Cost-conscious task discovery

Prefer `backlog task list --ready --sort priority --limit 10 --plain`, then inspect only the selected task. Avoid bulk task-view loops and broad JSON listings unless the task requires them. Load only the relevant detailed Backlog instruction guide for the lifecycle action you are taking.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
