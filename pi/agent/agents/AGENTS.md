# Pi subagent definitions

This directory contains the canonical, version-controlled Pi agent definitions linked to `~/.pi/agent/agents/`. Do not edit the installed path.

## Adding or changing an agent

- Add one Markdown file per agent. Its YAML frontmatter must declare a unique kebab-case `name`, a non-empty `description`, and explicit `tools`; the body is the agent's system prompt.
- Read-only roles may use only `read`, `grep`, `find`, and `ls`. Keep their brief and return contract narrow, evidence-based, and explicit about non-goals.
- `implementation-worker` is the only writable role. `presenter` is the only presentation role. Do not add another writable or presentation agent without changing and testing the extension's enforced capability model.
- Agent definitions are runtime-discovered, so do not create a second registry. Update `../extensions/subagent/README.md` only when the documented role contract or discovery behavior changes.
- Put portable role behavior in the committed definition. Provider/model selection is machine-local and belongs in untracked `~/.pi/agent/subagents.json`.
- Project-local `.pi/agents/` definitions are opt-in at dispatch time and require trust confirmation; do not use them to replace canonical harness roles.

Read `../../../decisions/subagents.md` before changing a delegation contract. If the extension's discovery, validation, capabilities, or isolation rules must change, follow `../extensions/subagent/AGENTS.md` and run `bun test pi/agent/extensions`.
