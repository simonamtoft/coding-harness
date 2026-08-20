# Subagent extension

Adapted from Pi's bundled `examples/extensions/subagent/` implementation. It exposes a `subagent` tool that launches specialized agents in isolated Pi subprocesses and supports single, parallel, and chained execution.

## Installed review agents

Agents are loaded from `~/.pi/agent/agents/*.md`:

- `correctness-reviewer` — Claude Sonnet 5, correctness and maintainability findings
- `security-reviewer` — GPT-5.6 Sol, threat-focused security findings

Both reviewers receive only `read`, `grep`, `find`, and `ls`. They cannot edit files or invoke arbitrary shell commands.

## Isolation change from the bundled example

Child processes include `--no-extensions`. This prevents global parent lifecycle extensions—especially `verify-turn`—from starting nested verification and repair loops inside read-only reviewers. It also means reviewer agents cannot use tools supplied by other extensions.

## Review workflows

The extension also exposes `review_changes`, which prepares and removes the temporary Git bundle itself and dispatches both reviewers in parallel.

- The main agent is instructed to call `review_changes` once, at its discretion, after non-trivial or risk-sensitive implementation work. It validates the findings and fixes those within the original task scope.
- Invoke `/review [base-ref]` for an explicit findings-only audit. It reports findings and asks before applying fixes.

Project-local agents remain disabled by default. The generic tool can include them only when explicitly called with `agentScope: "project"` or `"both"`; interactive use asks for confirmation.
