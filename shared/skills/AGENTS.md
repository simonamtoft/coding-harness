# Shared skill authoring

`shared/skills/` is the single source of truth for skills installed into both Pi and Claude. It is not a place for harness-specific tools, paths, prompts, or delegation syntax.

## Adding or changing a skill

- Create a directory named for the kebab-case skill and place its entry point at `SKILL.md`. Use YAML frontmatter with `name` and a specific `description` that lets the harness select the skill. Set `disable-model-invocation: true` only for deliberate user-triggered workflows.
- Keep the skill focused on one user intent and a precise output or stopping point. Extend an existing skill when the lifecycle and safety contract are the same; create a separate skill only when they materially differ.
- Write harness-neutral instructions. Resolve scripts, assets, and referenced files relative to the skill directory, never through `~/.pi/...` or `~/.claude/...`. When the harness calls differ, document the small Pi and Claude delegation variants without changing the common workflow.
- Do not call Pi-only extension tools from a shared skill. Put harness-only mechanisms in the appropriate harness resources instead.
- Read `decisions/skills.md` before proposing a new boundary. For a new reusable skill candidate, use `analyze-sessions` evidence rather than adding a speculative workflow.
- Keep companion scripts, templates, and examples inside the skill directory. Do not add credentials, generated output, installed state, or machine-local configuration.

Do not change `../AGENTS.md` for skill-authoring guidance: it is the global runtime instruction file linked into both harnesses.
