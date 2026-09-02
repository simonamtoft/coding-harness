# Fast diagnostics

Runs an optional project-declared diagnostic command after each successful Pi `edit` or `write` call. Its results are immediate **advisory feedback**: findings are appended to the originating tool result, but they do not block the agent or start a repair turn.

## Project contract

Create an executable `<repo root>/.agent/diagnostics.sh`. Pi runs it from the repository root with the changed file path as its sole positional argument:

```bash
#!/usr/bin/env bash
set -euo pipefail

npx eslint "$1"
```

The script is language-neutral: it owns the mapping from a changed path to the project's fastest useful check. It may ignore the argument when a package-level command is the narrowest valid check. Keep it fast; Pi gives each invocation 30 seconds.

Pi executes an immutable private copy of the approved script, so do not derive the repository path from `$0`; use the current working directory instead.

`0` means the diagnostic passed. Any other exit status, and all command output, are reported as advisory feedback. The extension treats an absent, non-executable, untrusted, or changed-after-approval script as unavailable and does not run it.

Before first use in an interactive session, Pi asks for a separate, content-bound approval for this repository-controlled script. Headless sessions fail closed. The script must resolve inside the project; symlinks outside it cannot be approved.

## Relationship to verification

This is not a replacement for the end-of-turn verifier. `.agent/verify.sh` or Taskfile `verify` remains the authoritative full-project check and can trigger the repair loop. Use the diagnostics script only for targeted feedback that remains useful after individual edits.
