# Verify turn

Runs a project verifier whenever Pi reaches `agent_settled`. A failing verifier is fed back to the agent so it can repair the change before handing control back.

## Verifier discovery

From the session working directory, in precedence order:

1. Executable `.pi/verify.sh`
2. A `verify` task in `Taskfile.yml` or `Taskfile.yaml`

If neither exists, the extension is a no-op.

Example:

```bash
mkdir -p .pi
cat > .pi/verify.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
npm run typecheck
npm test
SH
chmod +x .pi/verify.sh
```

## Retry behavior

The extension allows three verification-to-repair rounds. After the third repair attempt, it runs the verifier once more and surfaces any remaining failure without triggering another agent turn. A passing verification resets the counter.

Verifier output is capped at Pi's standard 2,000-line/50 KB limit, retaining the tail where test failures usually appear.

## Bypass

Start Pi with verification disabled for the session:

```bash
PI_VERIFY_DISABLE=1 pi
```
