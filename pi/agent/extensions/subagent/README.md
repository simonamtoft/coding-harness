# Subagent extension

Adapted from Pi's bundled `examples/extensions/subagent/` implementation. It exposes a `subagent` tool that launches specialized agents in isolated Pi subprocesses and supports single, parallel, and chained execution.

## Bundled and discovered agents

Bundled definitions live in this repository under `pi/agent/agents/` and are linked to `~/.pi/agent/agents/`. Additional definitions may be discovered at runtime from the user directory and, only when explicitly requested, the nearest project `.pi/agents/` directory.

Every role is owned by one skill or by extension dispatch code, and its brief lives once in the owning skill directory. The agent file is frontmatter plus a pointer to that brief.

Bundled roles and their owners:

- `presenter` — final HTML reports; owned by `present`. Its write tools are limited to report work
- `commit-planner` — commit grouping and messages from a supplied working-tree snapshot; owned by `quick-commit`
- `correctness-reviewer` — correctness and maintainability findings; owned by `code-review`, dispatched by `review_changes`
- `security-reviewer` — threat-focused security findings; owned by `security-review`, dispatched by `review_changes`
- `test-log-analyst` — diagnosis of an oversized test or build log artifact; owned by `diagnose-failure`
- `bulk-reader` — question-directed extraction from explicit large reference files; owned by `bulk-read`
- `repository-scout` — repository reconnaissance for a recon slice; owned by `swarm`
- `implementation-worker` — the only writable role; owned by `swarm`, and bounded slices require a coordinator-provided isolated cwd

Read-only roles receive only `read`, `grep`, `find`, and `ls`. `implementation-worker` receives those plus `bash`, `edit`, and `write`; `presenter` has a separate report-only capability. Unknown tools, malformed frontmatter, duplicate names, unknown agents, and scope mismatches fail closed. User model overrides take precedence over frontmatter models, which take precedence over the parent model; duplicate names across selected user/project scopes are rejected rather than shadowed.

Project agents are trusted only after interactive confirmation. In headless mode they are rejected by default; a caller must explicitly set `confirmProjectAgents: false` for a trusted project. Pi's capabilities and validation are intentionally narrower than Claude's task-role system; this extension provides only the roles and cwd guarantees Pi can enforce.

## Local model overrides

Set machine-specific agent models in `~/.pi/agent/subagents.json`:

```json
{
  "models": {
    "presenter": "IM-GPT/gpt-5.6-luna",
    "repository-scout": "IM-GPT/gpt-5.6-luna",
    "test-log-analyst": "IM-GPT/gpt-5.6-luna",
    "correctness-reviewer": "IM-GPT/gpt-5.6-terra",
    "security-reviewer": "openai-codex/gpt-5.6-sol"
  }
}
```

A local override takes precedence over an agent's frontmatter model. Without either value, the subagent inherits the active parent model and thinking level. Every child receives its resolved provider and model as separate CLI arguments: an override or frontmatter pin is honored independently of the parent, while an unpinned agent receives the parent's exact provider/model. Dispatch fails clearly if no provider-qualified model can be resolved or the selected provider/model is unavailable; it never silently switches providers. The local file is runtime configuration and is not linked from or committed to this repository.

## Isolation change from the bundled example

Child processes include `--no-extensions`. This prevents global parent lifecycle extensions—especially `verify-turn`—from starting nested verification and repair loops inside read-only reviewers. It also means reviewer agents cannot use tools supplied by other extensions. The sandbox is explicitly re-enabled for every child; parent read-routing is not, so bulk readers can inspect source without recursive cost routing while retaining filesystem restrictions.

## Swarm workflow

Invoke the shared `/skill:swarm` workflow. It requires an explicit frame, done predicate, partition/race/mixed shape, standalone briefs, terminal evidence, and parent-owned aggregation. Read-only workers may share a checkout. Write workers require distinct pre-created worktrees and explicit absolute `cwd` values; the parent owns allocation, merge, and cleanup. Dropouts remain visible as `BLOCKED` rather than receiving a generic fallback.

## Review workflows

The extension also exposes `review_changes`, which prepares a temporary Git bundle inside the session directory, excludes that file from its own snapshot, and removes it afterward. It runs the correctness reviewer by default; passing `security: true` adds the security reviewer in parallel. Keeping the bundle inside the session directory lets the headless reviewers read it through the sandbox guard.

- The main agent is instructed to call `review_changes` once, at its discretion, after non-trivial implementation work. When `verify-turn` discovers an automatic verifier, an autonomous call is deferred and reissued once only after that verifier passes. Review-driven fixes verify normally but do not schedule another review. Backlog/task-management-only, documentation-only, formatting-only, generated-only, and obviously trivial changes are excluded.
- Security review is reserved for changes affecting security-sensitive trust boundaries or explicit user requests.
- Invoke `/review [base-ref]` for an explicit findings-only correctness and security audit. It bypasses automatic deferral, reports findings, and asks before applying fixes.

Project-local agents remain disabled by default. The generic tool can include them only when explicitly called with `agentScope: "project"` or `"both"`; interactive use asks for confirmation.
