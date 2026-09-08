# Pi subagent definitions

This directory contains the canonical, version-controlled Pi agent definitions linked to `~/.pi/agent/agents/`. Do not edit the installed path.

## Ownership

A subagent is an implementation detail of an owning skill or of extension dispatch code, never a free-floating capability. A role nothing dispatches is never reached, so do not add one without an owner, and delete a role whose owner disappears.

Every role follows one layout:

```text
shared/skills/<owner>/SKILL.md        when the skill fires, how each harness dispatches, what the parent does with the result
shared/skills/<owner>/<ROLE-NAME>.md  the agent brief, one copy, harness-neutral
pi/agent/agents/<role>.md             Pi frontmatter + pointer to ~/.pi/agent/skills/<owner>/<ROLE-NAME>.md
claude/agents/<role>.md               Claude frontmatter + pointer to ~/.claude/skills/<owner>/<ROLE-NAME>.md
```

A Claude counterpart is optional per role and its behavior is not covered by the Pi tests. `implementation-worker` has none, because Claude has no equivalent of the coordinator-provided worktree contract.

## Adding or changing an agent

- Add one Markdown file per agent. Its YAML frontmatter must declare a unique kebab-case `name`, a non-empty `description`, and explicit `tools`; the body is only the harness-specific role framing plus the pointer to the shared brief.
- Name roles in backticks in skill prose. `ownership.test.ts` fails on an orphaned agent, a skill naming a role discovery does not produce, or a pointer path that does not resolve.
- Read-only roles may use only `read`, `grep`, `find`, and `ls`. Keep their brief and return contract narrow, evidence-based, and explicit about non-goals.
- `implementation-worker` is the only writable role. `presenter` is the only presentation role. Do not add another writable or presentation agent without changing and testing the extension's enforced capability model.
- Agent definitions are runtime-discovered, so do not create a second registry. Update `../extensions/subagent/README.md` only when the documented role contract or discovery behavior changes.
- Put portable role behavior and canonical built-in model defaults in the committed definition. Machine-specific provider/model selection belongs in untracked `~/.pi/agent/subagents.json`, which overrides the canonical default.
- Project-local `.pi/agents/` definitions are opt-in at dispatch time and require trust confirmation; do not use them to replace canonical harness roles.

Read `../../../decisions/subagents.md` before changing a delegation contract or an ownership assignment. If the extension's discovery, validation, capabilities, or isolation rules must change, follow `../extensions/subagent/AGENTS.md` and run `bun test pi/agent/extensions`.
