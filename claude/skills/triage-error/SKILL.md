---
name: triage-error
description: Use when the user pastes an error log, stack trace, build failure, or runtime exception and asks for diagnosis — "what's wrong", "why is this failing", "help me fix this error". Distinct from debug-empty-or-zero-output, which is for missing or zero results without an error message. Enforces "name the root cause before proposing a fix".
---

# Triage an error

Diagnose a pasted error log or stack trace by identifying the layer it came from, separating root cause from trigger, and naming the cause before proposing any fix.

## When this triggers

- User pastes a stack trace, build error, runtime exception, or stderr block
- "Why is this failing?" / "What does this error mean?" / "Help me fix this"
- Compiler/linker errors, language runtime exceptions, HTTP/auth errors, OS errors

**Not this skill:** empty output / zero metric / no rows — use `debug-empty-or-zero-output` instead.

## Procedure

1. **Identify the layer** the error came from. Be explicit:
   - **Compile/build** — type errors, missing imports, package resolution
   - **Runtime exception** — language-level (NullReferenceException, KeyError, panic)
   - **Infrastructure** — HTTP 4xx/5xx, auth/permission, DNS, timeout, port-in-use
   - **Test framework** — assertion failure, fixture/setup error
   - **OS/shell** — command not found, permission denied, no space left
2. **Read the *last* error first.** Most stack traces are misleading on top — the innermost frame or the final stderr line is usually closer to the cause.
3. **Reproduce minimally.** Confirm with the user: the exact command, the inputs, the environment. Don't diagnose what you can't reproduce in principle.
4. **Separate root cause from trigger.** A `NullReferenceException` at line 200 is the trigger; the missing config / unset env var / null return upstream is the cause. Name the cause explicitly before suggesting a fix.
5. **Then propose the fix.** One concrete change tied to the named cause.

## Rules

- **No fix without a named root cause.** "Try this" without a hypothesis is forbidden — it's the loop the user has pushed back on in past sessions.
- **Print commands, don't run them.** If the diagnosis or fix requires shell commands, print them for the user to run. Only read-only lookups (`ls`, `cat`, `--version`) are exempt.
- **One hypothesis at a time.** If hypothesis #1 doesn't hold up, say so before proposing #2 — don't spray suggestions.
- **Match-don't-mismatch the layer.** Don't propose code changes for an infrastructure error or env changes for a logic bug.

## Common categories and quick recipes

- **Dependency not installed / wrong version:** check `package.json`/`pyproject.toml`/`*.csproj` against installed (`pip list`, `dotnet --list-sdks`, `node --version`).
- **Auth / permission:** check the env var or token first, not the code.
- **Port / file lock in use:** `lsof -i :<port>` / `lsof <file>`; identify the holder, don't kill blindly.
- **Encoding / path:** non-ASCII paths, CRLF vs LF, Windows-vs-Unix path separators, absolute vs relative cwd.
- **OOM / timeout:** check the limit before optimising the code (often a config knob).
- **Stale cache / build artefacts:** suggest a clean-rebuild only after the cause makes that plausible, not as a first move.

## Done means

- The layer is named.
- The root cause is named (not just the trigger).
- One concrete fix is proposed, tied to the cause.
- If the user runs the fix and it doesn't work, restart from step 1 — don't iterate fixes on a wrong hypothesis.
