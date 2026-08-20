---
name: investigate-failing-ci
description: Use when CI is red, a GitHub Actions / Jenkins / CircleCI run is failing, a required check is blocking a PR merge, or the user asks "why is the workflow failing". Enforces reading the workflow definition before the failure log and classifying the failure as infrastructure / real test / flake before proposing a fix.
---

# Investigate a failing CI run

Diagnose a failing CI job by reading the workflow definition first, classifying the failure (infra / real / flake), and proposing a fix tied to the cause — never by disabling the check.

## When this triggers

- "CI is failing", "GitHub Actions is red", "why is the workflow failing"
- A required check is blocking PR merge
- A flaky job is failing intermittently
- A new workflow run regressed after a code or config change

## Procedure

1. **Read the workflow definition** (`.github/workflows/*.yml`, `Jenkinsfile`, `.circleci/config.yml`, etc.) *before* reading the failure log. The log is meaningless without knowing what the job was supposed to do.
2. **Read the failure log**, focusing on the failing step. Note the step name, the command that ran, the exit code, and the last 20-30 lines before the failure marker.
3. **Classify the failure:**
   - **Infrastructure** — runner died, action timed out, network unreachable, secret unavailable, image pull failed, disk full. Not the code's fault.
   - **Real** — code regression, test that genuinely fails on this commit, lint/type error introduced by the diff.
   - **Flake** — passes on rerun, race condition, time-dependent test, order-dependent test.
4. **Check what changed.** Is the failure in code the PR touched, or in code/config it didn't? Did an upstream change land (action version bump, secret rotation, dependency moved)?
5. **Reproduce locally if possible.** CI is usually just shell — copy the failing command from the workflow and run it on the user's machine. If it fails locally too, it's a real failure, not an infra problem.
6. **Propose the fix** tied to the classification: infra → retry / pin / contact infra owner; real → code change; flake → quarantine + ticket, don't pretend it's fixed.

## Rules

- **Read workflow first, log second.** Reversing this order leads to fixing the wrong layer.
- **Don't disable or skip checks as a fix.** A failing CI is information. Only suggest `continue-on-error`, `if: false`, or removing a check if the user explicitly asks — and even then, surface what's being silenced.
- **Don't fix flakes by retrying until green.** Mark them as flake, file a ticket, move on.
- **Print commands, don't run them.** Local reproductions and `gh run rerun` etc. are printed for the user.
- **No fix without a named cause.** Shared rule with `triage-error`.

## Common patterns

- Secret/token missing → check repo settings, not the code
- Action version pinned to a moved tag (`@v3` → `@v4` breaking change)
- Self-hosted runner offline
- Cache key collision producing wrong artefacts
- Test depends on time / random / network
- Workflow ran on `pull_request` event but expected `push` (different secrets/env)
- Required check renamed; branch protection still expects the old name

## Done means

- Failure classified as **infra / real / flake**.
- The owning layer is named (workflow file, code, dependency, secret, runner).
- A concrete next step the user can take, with a printed command if applicable.
- If real: the underlying bug, not a green-by-retry shortcut.
