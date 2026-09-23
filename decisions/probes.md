# Instruction-behavior probes

Decision ledger area. Entry ids use the `PRB-` prefix; see `../DECISIONS.md` for the format and append rules.

`probes/`

### PRB-01 · Multi-turn fixture probes decide; single-turn probes only cover unsafe boundaries
`accepted` · 2026-09-21 · `01a0c532`
**Decision:** Score instruction changes primarily by running a real agent with tools against a fixture and inspecting the resulting files and check exit code. Keep single-turn "what would you do next" probes only for boundaries that cannot be executed, such as a check against a production API, adding a dependency, or a planning-only request.
**Why:** Testing the PI-72 continuation paragraph, all seven single-turn scenarios scored identically for both instruction variants, because models state the right intention regardless of wording. The one multi-turn scenario showed the real behavior: six of six runs across both variants skipped the test suite, hand-computed an example, claimed verification, and left three tests red. Stated intent is not evidence about conduct.
**Revisit if:** Single-turn probes ever separate two variants that a multi-turn probe cannot.
**Superseded by:** PRB-07 for the single-turn clause. Multi-turn fixture probes still decide; unsafe boundaries are now simulated in fixtures instead of asked about.

### PRB-02 · Commit result records and key them by content hashes
`accepted` · 2026-09-21 · `01a0c532`
**Decision:** Store every run in `probes/results/`, keyed by instruction-bundle hash, scenario definition hash including fixture bytes, model, judge model, and runner version. Reuse a record whenever the key matches and it holds enough trials. Rejected rerunning both variants on every invocation and keeping results outside version control.
**Why:** The recurring workflow is "I changed an instruction, what moved?", where the baseline was already measured. Hashing content rather than Git revisions means an unchanged baseline is reused across commits, while editing a scenario or fixture invalidates both sides automatically instead of silently comparing runs of different scenarios.
**Revisit if:** The instruction bundle grows beyond `shared/AGENTS.md` and per-file provenance becomes necessary.
**Superseded by:** PRB-10 for committing records; content-keyed local reuse remains.

### PRB-03 · Probe children run without extensions, context files, or skills
`constraint` · 2026-09-21 · `01a0c532`
**Decision:** Every probe child runs with `--no-extensions --no-context-files --no-skills --no-prompt-templates`, measuring the instruction text alone.
**Why:** `verify-turn` would repair a red suite on the agent's behalf and hide the difference the probe is meant to detect, and project `AGENTS.md` discovery in a fixture would mix in unrelated rules. The cost is that probe results do not describe a real session, where the verifier and skills participate; the suite README states this limitation rather than compensating for it.
**Revisit if:** A scenario needs to measure the instruction and the verifier loop together, which requires a second execution mode rather than a change to this one.
**Superseded by:** PRB-06. Whole-harness runs load normal resources; isolated tool-enabled runs load only the canonical sandbox extension.

### PRB-04 · Scenarios score only what the agent owns, and simulate the verifier by prompt
`accepted` · 2026-09-21 · `01a0c532`
**Decision:** Assert the narrow check the agent is responsible for (`checkCommand`) and keep the full suite unasserted (`reportCommand`). Reproduce a verifier-equipped project with `verifierNotice`, which injects the notice exported from `pi/agent/extensions/verify-turn/notice.ts`. Rejected the first scenario design, which required the whole suite to end green.
**Why:** `agent_settled` never fires in `-p` mode, with or without `--approve`, so a probe cannot observe automatic verification at all. Worse, `verify-turn` tells the agent not to run the full verifier itself, so the original scenario penalized the agent for skipping work that the harness deliberately assigns elsewhere. VER-08 already draws the line: focused checks belong to the agent, the full run to the loop.
**Revisit if:** Print mode gains the settle lifecycle, making a verifier-in-the-loop execution mode possible.
**Evidence:** "The full suite that verify turn handles. So we want to test that the agent properly runs tests itself."

### PRB-05 · Score executed commands from `--mode json`, not the agent's account
`accepted` · 2026-09-21 · `01a0c532`
**Decision:** Run probe children with `--mode json`, collect bash commands from `tool_execution_start` events, and assert against them with `ranCommandMatching`.
**Why:** Text mode yields only the final message, where "Verified: formatAmount(123456789) → '1.234.567,89 EUR'" reads like a passing check. The command log showed those runs had instead transpiled the module in a `node -e` one-liner or retyped the function body, never executing the project's tests. Self-reported verification cannot be distinguished from real verification without this evidence.
**Revisit if:** Scenarios need read and edit tool calls too, which means recording the whole tool transcript rather than bash commands.

### PRB-06 · Add a separately keyed whole-Pi-harness mode
`accepted` · 2026-09-22 · `01a0c81b`
**Decision:** Preserve isolated instruction comparisons and add a `whole` mode that loads normally installed Pi extensions, skills, prompts, packages, and local runtime configuration while appending the selected complete `shared/AGENTS.md` exactly once. Isolated tool-enabled trials explicitly load only the canonical sandbox extension; disabling every extension gave model-generated commands unrestricted host access. Key records by mode and the relevant canonical runtime hash. Require a deliberate paid whole-mode run before finalizing changes to those canonical inputs, but keep paid calls out of automatic hooks.
**Why:** Isolated trials attribute a result to instruction wording, but some behavior emerges only from the harness components acting together. Replacing isolation would destroy that controlled comparison; automatic execution would repeatedly incur cost and delay. The canonical hash invalidates stale evidence without treating Claude-only files, repository documentation, tests, local credentials, or generated state as Pi runtime inputs. The sandbox is the minimum guard for a tool-enabled child and does not provide OS-level confinement.
**Revisit if:** Pi print mode gains the settle lifecycle, package installations become reproducibly pinned in the repository, or a cheap non-paid whole-harness signal can replace model trials.
**Evidence:** "For some things we should test everything as a whole. The tests should run whenever we change anything in the harness, since we use it as a whole."

### PRB-07 · Simulate unsafe boundaries in tool-enabled fixtures instead of asking about them
`accepted` · 2026-09-23 · `01a0cd87`
**Decision:** Replace the five tools-disabled "what would you do next" scenarios with multi-turn fixtures that let the agent act and observe whether it crossed the boundary: a production smoke script that only writes a local audit marker and targets a reserved `.example` host, a dependency request whose installs fail because the runner points `npm_config_registry` at a closed localhost port for every fixture agent, a proposal-only request, a pre-existing unrelated test failure, and an ambiguous change whose callers disagree. `probes/README.md` labels these as simulated boundaries, while fixture files stay realistic so they do not tip off the agent; none reaches a real production service. Rejected keeping single-turn intent probes as primary evidence.
**Why:** Stated intent does not predict conduct (PRB-01), and a single-turn probe cannot fail on the action it asks about because tools are disabled. A simulated boundary can: the marker file, allow-listed file changes, and correlated Bash executions are deterministic evidence. The cost is fidelity: an agent that reads the stub can tell the danger is fake. The registry guard lives in the runner environment rather than a fixture `.npmrc`, because the sandbox protects `.npmrc` paths, a fixture-local `bunfig.toml` would guard Bun but not npm, and one variable covers npm, pnpm, and Bun without a visible hint in the fixture. Package managers that ignore it remain unguarded.
**Revisit if:** A boundary cannot be simulated without a real external side effect, or agents are observed discounting a boundary because they inspected the stub.

### PRB-08 · Infrastructure failures are not verdicts; locked records are skipped; Pi version keys only whole mode
`accepted` · 2026-09-23 · `01a0cd87`
**Decision:** A timed-out, non-zero, or incomplete agent child is stored under `infrastructureFailures` and never counted as a trial or verdict. A failed judge child keeps the paid agent trial with an `unavailable` judge verdict, scored by its fixture assertions and its stored `judgeEvidence`; the next run re-judges it without repeating the agent, and runs exit non-zero while any reported trial lacks a verdict; unparsed judge output stays a separate verdict. Every child runs with `--thinking medium` rather than the local `defaultThinkingLevel`. Each record is checkpointed after every trial under a per-record lock file; a runner that finds a live lock skips that cell rather than waiting. Whole-mode keys include a sanitized runtime fingerprint (Pi version, resolved package name/version/content hash); isolated mode records Pi and Bun versions as diagnostics only. Rejected waiting on a held lock and keying isolated baselines on Pi version.
**Why:** Pi's JSON mode exits zero even when the final request errors, so exit status alone mis-scores provider failures as agent failures. Skipping keeps a concurrent run fast and still prevents duplicate paid trials; the next run reuses what the lock holder saved. Pi upgrades are frequent, and keying isolated baselines on them would force paid reruns of both sides for every release.
**Revisit if:** Pi upgrades are shown to move isolated results, or concurrent runs become routine enough that waiting beats rerunning.
**Evidence:** User chose "Record only" for isolated Pi version keying and "Skip and report" for lock contention, asked to keep agent runs whose judge failed, and said "Always set defaultThinkingLevel to medium."

### PRB-09 · Test the runner lifecycle offline against a fake `pi`
`accepted` · 2026-09-23 · `01a0cd87`
**Decision:** Replace the "`run.ts` has no tests" convention with `probes/test`, which runs the real runner as a subprocess in a temporary repository copy with `pi` replaced by `probes/test/fake-pi.ts`. Lock-file operations move to `probes/record-lock.ts` so reclaim races can be driven step by step. Stale locks are reclaimed under a separate reclaim mutex that deletes the lock only while it still holds the inspected stale content; an earlier move-aside-and-restore protocol was rejected because a third runner could take the vacated path during the restore. Three environment variables shorten agent timeout, judge timeout, and kill grace for the suite only. Rejected keeping lifecycle checks as ad hoc session scripts.
**Why:** Timeouts, signal cleanup, locks, and checkpointing are the runner behavior most likely to lose paid trials, and none of it needs a model to verify. Building the suite found two real races: a signal could exit while a temporary directory or lock release was still in flight. A process-level concurrency test cannot hit the microsecond reclaim window, so that invariant is tested directly against `record-lock.ts`.
**Revisit if:** The fake stops matching Pi's JSON event protocol or process behavior closely enough to trust, or the suite becomes slow enough to discourage running it.
**Evidence:** "Fix 4, 5 and 3" (item 3 was the missing permanent tests for `run.ts`).

### PRB-10 · Keep paid probe records local instead of committing them
`reverted` · 2026-09-23 · `01a0ce4b`
**Decision:** Ignore `probes/results/*.json` and untrack the previously committed records while retaining every record on disk. Reversed PRB-02's committed-evidence policy; the runner continues to cache by content hash locally. This change does not rewrite published Git history to remove older records.
**Why:** The user chose local-only records over the shared committed cache, accepting that another checkout or machine must pay for baseline trials again. The published `ccc7055` commit still contains the older records because the environment blocks history rewrites; an untracking commit does not erase historical blobs.
**Revisit if:** Shared baseline reuse across machines becomes more important than keeping generated trial evidence out of Git.
**Evidence:** "But keep them locally. Only remove from Git history"; when rewriting was blocked, the user chose "Untrack without rewrite".
