# Harness behavior probes

Measures whether instruction or harness changes alter agent behavior. Each probe runs a real
`pi` child against a scenario and scores the outcome, so changes are compared through conduct
rather than argued from their wording or implementation.

The runner has two modes:

- `isolated` (default) tests one complete `shared/AGENTS.md` variant with context-file discovery,
  skills, prompt templates, and all extensions except the canonical sandbox disabled. Use it to
  attribute behavior specifically to instruction wording without giving a tool-enabled child
  unrestricted host filesystem access.
- `whole` loads the normally installed Pi extensions, skills, prompt templates, packages, and
  other local runtime configuration while still appending exactly one selected `shared/AGENTS.md`
  variant. Use it before finalizing any change to the effective canonical Pi harness.

Every non-dry run makes paid model calls and takes minutes. The suite is manual and deliberately
outside automatic verification.

## Running

```bash
bun probes/run.ts --compare                              # isolated baseline (git HEAD) vs candidate (working tree)
bun probes/run.ts --compare --dry-run                    # what would run, what is already cached
bun probes/run.ts --harness-mode whole                   # candidate against the installed whole Pi harness
bun probes/run.ts --scenario focused-check-own-change     # one scenario, isolated candidate only
bun probes/run.ts --compare --variant /tmp/alt.md        # add a third complete instruction variant
bun probes/run.ts --models anthropic/claude-opus-5,openai-codex/gpt-6-astra
```

Run `link.sh` before whole-harness probes so the normal Pi resource discovery points at this
checkout, and run `link.sh --packages` when `pi/agent/packages.txt` changed. Whole mode keeps
`--no-context-files`: the selected complete `shared/AGENTS.md` is appended explicitly, avoiding a
second copy from normal global context discovery. Project-specific context belongs in a scenario
fixture when it is part of the behavior under test.

The working tree supplies the `candidate` content. `--compare` adds the `HEAD` content as
`baseline`. Variants with identical content are collapsed in resolution order, so a clean
`--compare` runs one baseline-labelled variant. A `--variant` file should contain a complete
alternative `shared/AGENTS.md`, not only a changed paragraph.

Defaults: models `anthropic/claude-sonnet-5` and `openai-codex/gpt-5.6-luna` (one large, one
small, two vendors), 3 trials, judge `anthropic/claude-sonnet-5`, harness mode `isolated`.

## Before and after without paying twice

Records in `probes/results/` are committed and keyed by harness mode, effective canonical Pi
harness hash, instruction hash, scenario definition hash, model, judge model, and runner version.
The scenario hash includes every fixture path and its UTF-8 file content. A run reuses any record
whose key matches and that has at least the requested number of trials. Asking for more trials
tops the record up with the difference instead of rerunning what is stored.

Isolated mode hashes the canonical sandbox extension that it explicitly loads for tool-enabled
trials. Whole mode hashes the canonical runtime inputs under `pi/agent/agents`, runtime TypeScript under
`pi/agent/extensions`, `pi/agent/prompts`, `pi/agent/mcp.json`, `pi/agent/packages.txt`, and
`shared/skills`. It excludes tests, generated caches, repository documentation, Claude-only
resources, local settings and model configuration, and installed package bytes. The manifest
changes the hash, but the runner cannot prove that the matching package revision is installed.

- After editing only `shared/AGENTS.md`, the isolated baseline side can be reused and only the
  candidate costs money.
- After editing another effective Pi harness input, whole-mode records rerun even when the
  instruction content is unchanged.
- After editing a scenario or fixture, its scenario hash changes, so both variants rerun.
- After changing models, judge, harness mode, harness hash, or `RUNNER_VERSION`, the affected setup
  reruns. Earlier records stay under their own names, so switching back can reuse them.

Records whose runner version or hashes no longer match stay as evidence but are never reused as
input. The `focused-check-own-change` records from runner version 2 are PI-72 evidence: their
`commands` arrays show that 4 of 12 trials ran the project's tests at all. The candidate variants
produced one passing trial out of six, which is also why small differences should not be treated
as conclusive.

Trials are stochastic. Treat a one- or two-trial difference between variants as noise unless
repeated evidence supports it.

## Scenario kinds

Multi-turn scenarios are primary. They copy `fixture/` to a temp directory, run `checkCommand`
there to confirm the fixture starts green, run the agent with tools, then rerun `checkCommand` and
compare files. They detect what an agent *did*. Every multi-turn scenario must explicitly set
`assertions.checksPass` to its expected post-run state.

Probe children run with `--mode json`, so the runner records the Bash commands the agent actually
executed. Command assertions use that evidence rather than the agent's own account:

- every pattern in `ranCommandMatching` must match at least one command;
- at least one pattern in `ranAnyCommandMatching` must match a command.

Use one specific pattern when only one command is acceptable. The command can be `bun test`,
`npm test`, `python -m pytest`, `cargo test`, or any other scenario-appropriate command.

Two scenario fields keep a scenario honest about verification ownership (VER-08): `checkCommand`
is the narrow check the agent owns and its expected state is asserted, while `reportCommand` runs
afterwards for the judge's information only. Use the latter for the full suite the automatic
verifier owns. Setting `verifierNotice` appends the same guidance `verify-turn` injects when a
project verifier is active, imported from `pi/agent/extensions/verify-turn/notice.ts` so the
wording cannot drift.

Single-turn scenarios ask what the agent would do next and score the answer. They exist only for
stop boundaries that cannot be executed safely — a check that hits a production API, adding a
dependency, or a planning-only request. They measure stated intent, which is weaker evidence than
a fixture run.

## Scoring

Each trial gets up to two independent verdicts:

- **Fixture assertions** (multi-turn only, deterministic and free): `checksPass`, `filesChanged`,
  `filesUnchanged`, `ranCommandMatching`, and `ranAnyCommandMatching`.
- **Judge** (one extra model call): the scenario's `judge` field states what PASS means. The judge
  sees the task, the agent's final message, post-run check and report output, and captured Bash
  commands. It never sees the instruction variant, so it scores behavior rather than compliance
  with wording.

## Limitations

Isolated children run with `--no-extensions --no-context-files --no-skills
--no-prompt-templates`, then tool-enabled trials explicitly load only the canonical sandbox
extension. `verify-turn`, skills, and other extensions therefore cannot mask or substitute for the
instruction under test, while the sandbox still enforces this repository's command and filesystem
policy. The sandbox is not an OS security boundary. Whole mode removes the resource isolation
except for context-file discovery, which remains disabled so the explicit instruction variant is
loaded exactly once.

Neither mode can observe the automatic verifier repair round: `agent_settled` never fires in `-p`
mode, with or without `--approve`. `verifierNotice` reproduces the prompt conditions of a
verifier-equipped project but not its lifecycle. A future verifier-in-the-loop launcher would be
a separate execution mode.

Whole mode depends on the locally installed Pi configuration for package loading and provider
access. Its canonical hash does not encode local settings, installed package source revisions,
Pi's built-in system prompt or executable version, provider-side model revisions, or credentials.
Record those limitations when interpreting a whole-harness result.

The retained transcript evidence is the executed Bash command strings plus the final assistant
message, not the full tool transcript. Reads, edits, non-Bash tools, and the outputs of the
agent's own Bash calls are invisible. Fixture assertions can still observe resulting UTF-8 file
content and check exit status.
