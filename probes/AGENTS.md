# Instruction-behavior probes

Manual, paid evaluation harness for instruction changes. `README.md` here explains running and
caching; this file states the authoring constraints.

## Constraints

- Never wire `run.ts` into `.agent/verify.sh`, a Taskfile `verify` task, or any hook. Runs cost
  money and take minutes. Run whole-harness probes deliberately before finalizing a change to an
  effective canonical Pi runtime input.
- Keep `lib/` pure and offline. Process and model work belongs in `run.ts`; lock-file work belongs
  in `record-lock.ts`. `bun test probes/lib probes/test` must pass without credentials or model
  calls. `probes/test` runs the real runner against `test/fake-pi.ts` in a temporary repository
  copy; extend it when changing runner lifecycle, locking, or cleanup, and never point it at the
  local `results/`.
- Keep `results/` local and untracked. They are the "before" side of the next comparison on this
  machine; deleting one means paying for it again.
- Bump `RUNNER_VERSION` in `lib/cache.ts` when execution or scoring changes in a way that makes
  older records incomparable. Do not edit stored records by hand or commit result, lock, or staging files.
- Never let a child-process failure become an agent verdict. Timeouts, non-zero exits, and
  incomplete agent runs are infrastructure failures recorded apart from trials; a failed judge
  keeps the trial with an `unavailable` verdict.
- Keep isolated and whole-harness records distinct. Isolated tool-enabled trials load only the
  canonical sandbox and hash it; whole mode hashes canonical runtime inputs but must not absorb
  raw local settings, credentials, installed package bytes, or Claude-only resources. Whole mode's
  runtime fingerprint records only the sanitized identity described in `README.md`.

## Authoring a scenario

One directory under `scenarios/`, named for the behavior it measures, containing `scenario.json`
and — for multi-turn — a `fixture/` directory whose `checkCommand` passes before the agent runs.

- Write `judge` so PASS names the desired behavior and the FAIL clause names the specific failure
  mode you expect to see. A vague expectation produces a vague verdict.
- Prefer a fixture assertion to a judge sentence whenever the outcome is observable in files,
  exit codes, or the commands the agent ran.
- Respect VER-08: declare the expected narrow `checkCommand` state with `assertions.checksPass`,
  and put the full suite in `reportCommand`, which informs the judge without being asserted. A
  scenario that requires whole-suite green scores the agent for work the automatic verifier owns.
- Use `ranCommandMatching` when every listed pattern is required. Use `ranAnyCommandMatching` when
  any one listed pattern is acceptable; use one specific pattern when only one command is valid.
  Patterns match simple-command segments of executed Bash calls, so anchor them (`^bun\s+test\b`)
  to reject incidental strings such as `echo bun test`.
- Use `allowedChangedFiles` to prove a stop boundary held: `[]` for proposal-only or ask-first
  behavior, or the exact files the requested change may touch.
- Probes cannot observe the automatic verifier, because `agent_settled` does not fire in `-p`
  mode. Never write a scenario whose expected behavior is a repair round triggered by
  verification; set `verifierNotice` to reproduce its prompt conditions instead.
- Simulate a dangerous boundary in the fixture instead of asking about it (PRB-07): a stub that
  leaves a local marker, a reserved `.example` host, or the runner's closed package registry. The stub must
  have no real external effect even if the agent runs it, and `README.md` must label it simulated.
  Add a single-turn scenario only when no safe simulation exists; it measures stated intent only.
- A scenario must be able to fail. Before trusting a new one, confirm at least one variant scores
  FAIL on it; a scenario every variant passes measures nothing.
