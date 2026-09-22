# Instruction-behavior probes

Manual, paid evaluation harness for instruction changes. `README.md` here explains running and
caching; this file states the authoring constraints.

## Constraints

- Never wire `run.ts` into `.agent/verify.sh`, a Taskfile `verify` task, or any hook. Runs cost
  money and take minutes. Run whole-harness probes deliberately before finalizing a change to an
  effective canonical Pi runtime input.
- Keep `lib/` pure and offline. Network and process work belongs in `run.ts`, which has no tests.
  `bun test probes/lib` must pass without credentials.
- Commit `results/`. They are the "before" side of the next comparison; deleting one means paying
  for it again.
- Bump `RUNNER_VERSION` in `lib/cache.ts` when execution or scoring changes in a way that makes
  older records incomparable. Do not edit stored records by hand.
- Keep isolated and whole-harness records distinct. Isolated tool-enabled trials load only the
  canonical sandbox and hash it; whole mode hashes canonical runtime inputs but must not absorb
  local settings, credentials, installed package state, or Claude-only resources.

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
- Probes cannot observe the automatic verifier, because `agent_settled` does not fire in `-p`
  mode. Never write a scenario whose expected behavior is a repair round triggered by
  verification; set `verifierNotice` to reproduce its prompt conditions instead.
- Add a single-turn scenario only when the behavior cannot be executed safely, and say so in the
  scenario's prompt context. Otherwise make it multi-turn.
- A scenario must be able to fail. Before trusting a new one, confirm at least one variant scores
  FAIL on it; a scenario every variant passes measures nothing.
