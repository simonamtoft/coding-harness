# Verify turn

Runs a project verifier when Pi reaches `agent_settled` after a completed model run that changes tracked or non-ignored untracked project content outside Markdown files. Read-only, commit-only, Markdown-only, and edit-then-commit runs are skipped; mixed Markdown/code changes without a commit are verified. Cancelling model output does not trigger verification. A failing verifier is fed back to the agent so it can repair the change before handing control back.

## Verifier discovery

From the session working directory, in precedence order:

1. Executable `.agent/verify.sh`
2. A `verify` task in `Taskfile.yml` or `Taskfile.yaml`

If neither exists, the extension is a no-op. Discovery and execution require Pi project trust only; there is no separate per-session verifier approval (see VER-13). Pi treats repositories without `.pi` resources as trusted automatically, so a verifier in such a repository runs without a prompt.

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

## Verifier-change review

An agent may edit the verifier (SBX-15), and there is no per-session trust prompt (VER-13), so the extension does not trust a verifier whose entry point the agent changed until it is reviewed. The entry point is `.agent/verify.sh` or the selected Taskfile. The session's accepted content is the entry point as first seen in the session, or no verifier when the session started without one; it changes only when a review clears an edit or the user accepts one. A verifier the agent creates is therefore reviewed too.

Before running a verifier whose entry point differs from the accepted content, the extension asks the `subagent` extension to dispatch the read-only `verifier-change-reviewer`. The reviewer gets a review bundle diffed against the accepted revision, the accepted entry-point text (up to 64 KiB), and the files changed in the triggering turn. It judges the entry point against its accepted text, so edits the user already accepted are not judged again, and judges weakening in tests or test configuration among the turn's files.

- `VERDICT: CLEAR` accepts the edit and runs the verifier.
- `VERDICT: CIRCUMVENTS`, any other output, a failed reviewer, or a missing `subagent` extension is undecided. In the terminal UI the report is shown and the user chooses to accept the change and run the verifier, or send it back. Without a UI, or when sent back, the verifier does not run and the report is fed to the agent as a failed round under the same three-round limit.

Because the comparison is against the accepted content, not the previous turn, a later turn that leaves the edited verifier untouched is reviewed again. A commit-only turn still skips verification, but the next verifier run reviews the committed edit. Weakening in tests alone, without a verifier edit, does not trigger this review; `subagent` review mode remains the general change review. Without Git snapshots, changes cannot be detected and the verifier runs as before.

## Retry behavior

The extension allows three verification-to-repair rounds. After the third repair attempt, it runs the verifier once more and surfaces any remaining failure without triggering another repair turn.

In interactive mode, a project-checks panel names the selected verifier, shows elapsed time, and streams its 12 most recent output lines. It explicitly reports that the verifier is still running and either that it has not produced output yet or how long ago it last did, so quiet runners such as Playwright do not look stalled. This panel covers deterministic project checks only; independent agent review remains a separate `subagent` review-mode step. The panel holds input focus until the verifier exits, so prompts and `!` commands cannot run concurrently with it. Escape cancels verification, waits for the verifier process to stop, and then restores the editor. Cancellation, session shutdown, and normal verifier exit terminate any remaining processes in that verifier's process group, preventing development servers and browser workers from leaking into later checks.

Outside the terminal UI, for example when Paseo drives Pi over RPC, there is no panel: the extension sends a notification when the checks start and another when they pass. Failures are reported to the agent as before.

When a verifier is configured, the extension tells the agent that the full project check runs automatically. The agent should still run targeted checks that provide useful feedback while implementing, but should not invoke the full verifier again as its final check.

A passing verification resets the counter and returns control without another model response. A failure still triggers a repair turn, and active repair rounds rerun the verifier even if the project content did not change or only Markdown changed.

Verifier output is capped at Pi's standard 2,000-line/50 KB limit, retaining the tail where test failures usually appear.

## Bypass

Start Pi with verification disabled for the session:

```bash
PI_VERIFY_DISABLE=1 pi
```
