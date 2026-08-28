# Verify turn

Runs a project verifier when Pi reaches `agent_settled` after a completed model run that changed tracked or non-ignored untracked project content outside Markdown files. Read-only, commit-only, and Markdown-only runs are skipped; mixed Markdown/code changes and runs that edit and then commit code are still verified. Cancelling model output does not trigger verification. A failing verifier is fed back to the agent so it can repair the change before handing control back.

## Verifier discovery

From the session working directory, in precedence order:

1. Executable `.agent/verify.sh`
2. A `verify` task in `Taskfile.yml` or `Taskfile.yaml`

If neither exists, the extension is a no-op. Discovery and execution require Pi project trust plus a separate, explicit verifier approval for the current session. The approval is bound to the verifier file's content; changing it stops automatic execution until a later turn is approved again. Headless sessions fail closed, and verifier symlinks resolving outside the project cannot be approved. This separate gate is necessary because repositories without `.pi` resources are otherwise treated as trusted automatically by Pi.

Both locations are deliberately harness-neutral, and Claude Code's `verify-turn.sh` Stop hook
resolves the same two in the same order. A project therefore wires **one** verifier that serves both
harnesses. The `wire-up-verifier` skill scaffolds it.

Example:

```bash
mkdir -p .agent
cat > .agent/verify.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm test
SH
chmod +x .agent/verify.sh
```

## Retry behavior

The extension allows three verification-to-repair rounds. After the third repair attempt, it runs the verifier once more and surfaces any remaining failure without triggering another repair turn.

In interactive mode, a project-checks panel names the selected verifier, shows elapsed time, and streams its 12 most recent output lines. It explicitly reports that the verifier is still running and either that it has not produced output yet or how long ago it last did, so quiet runners such as Playwright do not look stalled. This panel covers deterministic project checks only; independent agent review remains a separate `review_changes` step. The panel holds input focus until the verifier exits, so prompts and `!` commands cannot run concurrently with it. Escape cancels verification, waits for the verifier process to stop, and then restores the editor. Cancellation, session shutdown, and normal verifier exit terminate any remaining processes in that verifier's process group, preventing development servers and browser workers from leaking into later checks.

When a verifier is configured, the extension tells the agent that the full project check runs automatically. The agent should still run targeted checks that provide useful feedback while implementing, but should not invoke the full verifier again as its final check.

A passing verification resets the counter and returns control without another model response. A failure still triggers a repair turn, and active repair rounds rerun the verifier even if the project content did not change or only Markdown changed.

Verifier output is capped at Pi's standard 2,000-line/50 KB limit, retaining the tail where test failures usually appear.

## Bypass

Start Pi with verification disabled for the session:

```bash
PI_VERIFY_DISABLE=1 pi
```
