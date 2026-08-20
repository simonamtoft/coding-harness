---
name: wire-up-verifier
description: Use when working in a repo that has test/lint/typecheck commands but no verifier wired for the `verify-turn` Stop hook, or when the user asks to "wire up a verifier / set up the verify loop / add a verify task". Scaffolds a hook-compatible `.claude/verify.sh` or a Taskfile `verify` task so the per-turn verification loop self-runs.
---

# Wire up a project verifier

Scaffold a per-project verifier that the `verify-turn` Stop hook (`~/.claude/hooks/verify-turn.sh`)
picks up automatically, so completed turns self-check against the repo's real test/lint/typecheck
commands instead of the model's self-assessment.

## The hook contract

The Stop hook resolves a verifier in this precedence order, and is a **no-op** if neither exists:

1. `${CLAUDE_PROJECT_DIR}/.claude/verify.sh` — must be **executable**, takes no args, run from repo root.
2. A `verify` task in `Taskfile.yml` / `Taskfile.yaml`.

Exit `0` = pass; non-zero = fail. On failure the hook feeds the verifier's stderr back for up to 3
fix rounds. So the verifier must aggregate the repo's checks and **exit non-zero on the first
failure**.

## When this triggers

- Working in a repo that has a test/lint/typecheck command but no `.claude/verify.sh` and no
  `verify` task wired.
- "Wire up a verifier" / "set up the verify loop" / "add a verify task".

## Procedure

1. **Confirm there are checks to run.** Detect the repo's existing check commands from
   `package.json` scripts (`test`, `lint`, `typecheck`, `tsc`), `Taskfile.yml`, `Makefile`,
   `pyproject.toml` (`ruff`, `mypy`, `pytest`), `justfile`, or CI config. If none exist, say so and
   stop — don't invent checks.
2. **Check nothing is already wired.** If an executable `.claude/verify.sh` or a `verify` task
   already exists, don't duplicate it — report what's there and stop.
3. **Choose the target by the repo's convention.** If the repo already uses a Taskfile, add a
   `verify` task. Otherwise create `.claude/verify.sh`.
4. **Scaffold it** to run the detected checks in order typecheck → lint → test:
   - Shell form: start with `set -euo pipefail` so it fails fast and non-zero; `chmod +x` the file.
   - Taskfile form: list the check commands under a `verify` task; task fails non-zero on the first
     failing command by default.
   - Include only checks the repo actually has. Keep it minimal — no new tooling or dependencies.
5. **Confirm, then verify.** Show the user exactly what will run and confirm before writing. After
   writing, run it once to confirm it exits 0 when the tree is clean and non-zero when a check
   fails.

## Rules

- **Respect the hook contract exactly** — the paths, the executable bit, and the exit-code
  semantics are what the hook keys on.
- **Don't invent checks** the repo doesn't have; mirror its existing commands.
- **Keep it minimal** — no retry logic, no new packages, no config the repo doesn't already use.
- **Confirm before writing.** This adds a file/task to the user's repo.

## Done means

- A `.claude/verify.sh` (executable) or a Taskfile `verify` task that the Stop hook resolves.
- Verified to run: exit 0 on a clean tree, non-zero when a check fails.
