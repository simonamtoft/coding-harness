---
name: scaffold-one-off-script
disable-model-invocation: true
description: Use when the user asks for a small single-file utility script — extract data, upload a file, register something, run a one-off transformation, glue two CLIs together. Typically Python or shell. Enforces consistent CLI conventions, idempotency, fail-loudly behaviour, and the user's preference for argparse over click.
---

# Scaffold a one-off utility script

Generate a single-file utility script with consistent conventions for CLI parsing, logging, error behaviour, and idempotency — without bloating it past what the user asked for.

## When this triggers

- "Write me a small script to <X>"
- "Create a shell script that <X>"
- "Make a Python helper to <X>"
- One-off data extraction, upload, registration, ingestion, glue between two CLIs

## Procedure

1. **Confirm the happy path in writing before generating code.** Restate:
   - Inputs (args, files, stdin)
   - Outputs (stdout, files, side effects on remote systems)
   - Where it runs (user's laptop, CI, a server)
   - Run frequency (once, daily, every PR)
2. **Pick the language deliberately:** shell for pure CLI orchestration; Python when there's any parsing, structured I/O, or non-trivial logic. Don't default to Python for "run these 3 commands".
3. **Generate one file** following the conventions below.
4. **Print the invocation command** for the user to run — do not execute the script yourself (respect `feedback_terminal_commands.md`).

## Conventions

### Structure
- **One file.** No package layout, no `src/`, no `__init__.py`.
- Top of file: short docstring or comment with what it does and example invocation.

### CLI parsing
- **Python: `argparse`.** Do *not* use `click` — the user has an explicit recorded preference for `argparse` (a past session reversed `click` back to `argparse`).
- **Shell:** positional args for ≤3, `getopts` for more.
- Always include `--help` text describing each arg.

### Error behaviour
- **Fail loudly on bad input.** Validate args at the top; exit non-zero with a clear message rather than producing wrong output.
- **Python:** let exceptions propagate unless you can handle them meaningfully. Don't `except Exception: pass`.
- **Shell:** `set -euo pipefail` at the top; quote variables.
- **Exit codes:** 0 success, non-zero for any failure. Different codes for different failure classes if it'll help the caller.

### Idempotency
- **Running twice should be safe.** Either the script is naturally idempotent, or it checks-and-skips, or it refuses to run when its output already exists.
- If the script writes to a remote system that can't be made idempotent, say so explicitly in the docstring and in stderr at startup.

### Logging
- **Data output → stdout.** Anything the next command in a pipe would consume.
- **Diagnostics / progress / errors → stderr.** Including timestamps for long-running steps.
- For Python, prefer the stdlib `logging` module configured to stderr; don't pull in `loguru` or `structlog` for a one-off script.

### What NOT to add
- No retry/backoff unless the user asked.
- No config file unless args clearly aren't enough.
- No tests unless the user asked.
- No dependency on new packages if the stdlib suffices.

## Rules

- **A "small script" stays small.** Don't expand scope. If you find yourself adding modules, classes, or a config schema, stop and check with the user.
- **Don't run the script.** Print the invocation; the user runs it.
- **Don't silently mutate the user's environment.** If the script needs an env var or auth, fail at startup with a message rather than prompting interactively.

## Done means

- One file, runnable as-is.
- A printed example invocation the user can paste.
- Clear stderr message on bad input rather than a stack trace or wrong output.
