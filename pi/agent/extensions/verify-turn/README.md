# Verify turn

Runs a project verifier whenever Pi reaches `agent_settled`. A failing verifier is fed back to the agent so it can repair the change before handing control back.

## Verifier discovery

From the session working directory, in precedence order:

1. Executable `.agent/verify.sh`
2. A `verify` task in `Taskfile.yml` or `Taskfile.yaml`

If neither exists, the extension is a no-op.

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

Assistant output shown before the automatic verifier finishes is provisional. A passing verification resets the counter and triggers one report-only turn so the agent can provide the definitive full task report with the completed verification result. That report-only turn is not verified again, preventing an endless pass-report-verify loop.

Verifier output is capped at Pi's standard 2,000-line/50 KB limit, retaining the tail where test failures usually appear.

## Bypass

Start Pi with verification disabled for the session:

```bash
PI_VERIFY_DISABLE=1 pi
```
