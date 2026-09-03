---
name: wire-up-verifier
disable-model-invocation: true
description: Use when working in a repo that has test/lint/typecheck commands but no verifier wired for the `verify-turn` loop, or when the user asks to "wire up a verifier / set up the verify loop / add a verify task". Scaffolds a `.agent/verify.sh` or a Taskfile `verify` task so the per-turn verification loop self-runs.
---

# Wire up a project verifier

Scaffold a per-project verifier that the `verify-turn` end-of-turn check picks up automatically, so
completed turns self-check against the repo's real test/lint/typecheck commands instead of the
model's self-assessment.

## The contract

A verifier is resolved in this precedence order, and is a **no-op** if neither exists:

1. `<repo root>/.agent/verify.sh` — must be **executable**, takes no args, run from repo root.
2. A `verify` task in `Taskfile.yml` / `Taskfile.yaml`.

Exit `0` = pass; non-zero = fail. On failure the verifier's output is fed back for up to 3 fix
rounds. So the verifier must aggregate the repo's checks and **exit non-zero on the first failure**.

## Scope

This verifier is the authoritative **end-of-turn**, full-project gate. Use it for the repository's
established syntax, type, lint, formatting, and test commands. A non-zero result starts the repair
loop, so include style or formatting rules only when the repository treats them as required.

Keep language rules and preferences in the repository's existing tool configuration. The verifier
only orchestrates those commands; it does not install tooling or create policy. Do not generate
per-edit hooks here. Pi's separate optional `.agent/diagnostics.sh` contract provides advisory,
fast per-edit feedback when a project wants it.

Both locations are harness-neutral: they are resolved identically by Claude Code's `verify-turn.sh`
Stop hook and by pi's `verify-turn` extension. Scaffold one verifier per repo, never one per
harness.

## When this triggers

- Working in a repo that has a test/lint/typecheck command but no `.agent/verify.sh` and no
  `verify` task wired.
- "Wire up a verifier" / "set up the verify loop" / "add a verify task".

## Procedure

1. **Confirm there are checks to run.** Detect the repo's existing check commands from
   `package.json` scripts (`test`, `lint`, `typecheck`, `tsc`), `Taskfile.yml`, `Makefile`,
   `pyproject.toml` (`ruff`, `mypy`, `pytest`), `justfile`, or CI config. If none exist, say so and
   stop — don't invent checks.
2. **Check nothing is already wired.** If an executable `.agent/verify.sh` or a `verify` task
   already exists, don't duplicate it — report what's there and stop.
3. **Choose the target by the repo's convention.** If the repo already uses a Taskfile, add a
   `verify` task. Otherwise create `.agent/verify.sh`.
4. **Scaffold it** to run the detected checks in order typecheck → lint → test:
   - Shell form: start with `set -euo pipefail` so it fails fast and non-zero; `chmod +x` the file.
   - Taskfile form: list the check commands under a `verify` task; task fails non-zero on the first
     failing command by default.
   - Include only checks the repo actually has. Keep it minimal — no new tooling or dependencies.
5. **Confirm, then verify.** Show the user exactly what will run and confirm before writing. After
   writing, run it once to confirm it exits 0 when the tree is clean and non-zero when a check
   fails.

## Rules

- **Respect the contract exactly** — the paths, the executable bit, and the exit-code semantics are
  what the end-of-turn check keys on.
- **Don't invent checks** the repo doesn't have; mirror its existing commands.
- **Keep it minimal** — no retry logic, no new packages, no config the repo doesn't already use.
- **Confirm before writing.** This adds a file/task to the user's repo.

## Done means

- A `.agent/verify.sh` (executable) or a Taskfile `verify` task that `verify-turn` resolves.
- Verified to run: exit 0 on a clean tree, non-zero when a check fails.
