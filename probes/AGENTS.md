# Instruction-behavior probes

Manual, paid evaluation harness for instruction changes. `README.md` here explains running and
caching; this file states the authoring constraints.

## Constraints

- Never wire `run.ts` into `.agent/verify.sh`, a Taskfile `verify` task, or any hook. Runs cost
  money and take minutes. Run whole-harness probes deliberately at the batch points in
  `README.md` (PRB-11), not after every runtime change.
- Multi-turn probes without final-message expectations use assertions only. For a judged probe,
  only a broken hard boundary (`brokenBoundaries`) skips the judge; a missing required change or
  command does not suppress a final-message ruling.
- Mark a scenario `guard: true` only after stored trials show it passing on every default model.
  A discriminating scenario must keep the full default trial count.
- Keep `lib/` pure and offline. Process and model work belongs in `run.ts`; lock-file work belongs
  in `record-lock.ts`. `bun test probes/lib probes/test` must pass without credentials or model
  calls. `probes/test` runs the real runner against `test/fake-pi.ts` in a temporary repository
  copy; extend it when changing runner lifecycle, locking, or cleanup, and never point it at the
  local `results/`.
- Keep `results/` local and untracked. They are the "before" side of the next comparison on this
  machine; deleting one means paying for it again.
- Bump `RUNNER_VERSION` in `lib/cache.ts` when execution or scoring changes in a way that makes
  older records incomparable. Do not edit stored records by hand or commit result, lock, or staging files.
- Never let a child-process failure become an agent verdict. Timeouts, non-zero exits, host
  sleep during a child (PRB-12), and incomplete agent runs are infrastructure failures recorded apart from trials; a failed judge
  keeps the trial with an `unavailable` verdict. The one exception is a benchmark child stopped at
  a budget cap, including wall time: it is a scored `budget_exhausted` outcome.
- Record missing usage or timing as null, never as zero.
- Keep isolated and whole-harness records distinct. Isolated tool-enabled trials load only the
  canonical sandbox and hash it; whole mode hashes canonical runtime inputs but must not absorb
  raw local settings, credentials, installed package bytes, or Claude-only resources. Whole mode's
  runtime fingerprint records only the sanitized identity described in `README.md`.

## Authoring a scenario

One directory under `scenarios/`, named for the behavior it measures, containing `scenario.json`
and — for multi-turn — a `fixture/` directory whose `checkCommand` passes before the agent runs.

- Omit `judge` if fixture evidence fully decides the outcome. Otherwise write it only for the
  final-message claim the fixture cannot observe; PASS names the desired reply, and FAIL names
  the specific reply failure. Do not ask the judge to rule on files, exits, or commands.
- Use `forbiddenCommandMatching` for prohibited Bash attempts, including calls blocked before an
  exit status; positive command assertions require a completed tool call.
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
  mode. Never write a probe scenario whose expected behavior is a repair round triggered by
  verification; set `verifierNotice` to reproduce its prompt conditions instead. Only `benchmark`
  scenarios have repair rounds, which the runner drives itself.
- Simulate a dangerous boundary in the fixture instead of asking about it (PRB-07): a stub that
  leaves a local marker, a reserved `.example` host, or the runner's closed package registry. The stub must
  have no real external effect even if the agent runs it, and `README.md` must label it simulated.
  Add a single-turn scenario only when no safe simulation exists; it measures stated intent only.
- Benchmark tasks: put every answer-bearing file (seeded-defect patch, hidden tests, reference
  solution, must-find facts, defect lists, rubrics) under the task's `answers/`, never in
  `fixture/` or `start.patch`, which the agent sees. Pin fixtures in `fixtures.json` by full
  commit SHA with licence and contamination notes; never point a task at a live branch. Keep
  `.fixture-cache/` local and untracked.
- Judged tasks: back each must-find fact with `evidence` a maintainer can check, and describe each
  seeded defect by location and problem so a finding can be matched unambiguously. Keep
  `change.patch` free of hints such as comments that name the defect.
- Continuation tasks: give phase 1 a scope that ends before the task is done, so the handoff
  carries real state. Keep constraints that must survive the handoff in the phase-1 prompt only;
  repeating them in `continuation.prompt` hides whether the handoff preserved them.
- A scenario must be able to fail. Before trusting a new one, confirm at least one variant scores
  FAIL on it; a scenario every variant passes measures nothing.
