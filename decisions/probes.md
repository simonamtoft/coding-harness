# Instruction-behavior probes

Decision ledger area. Entry ids use the `PRB-` prefix; see `../DECISIONS.md` for the format and append rules.

`probes/`

### PRB-01 · Multi-turn fixture probes decide; single-turn probes only cover unsafe boundaries
`accepted` · 2026-09-21 · `01a0c532`
**Decision:** Score instruction changes primarily by running a real agent with tools against a fixture and inspecting the resulting files and check exit code. Keep single-turn "what would you do next" probes only for boundaries that cannot be executed, such as a check against a production API, adding a dependency, or a planning-only request.
**Why:** Testing the PI-72 continuation paragraph, all seven single-turn scenarios scored identically for both instruction variants, because models state the right intention regardless of wording. The one multi-turn scenario showed the real behavior: six of six runs across both variants skipped the test suite, hand-computed an example, claimed verification, and left three tests red. Stated intent is not evidence about conduct.
**Revisit if:** Single-turn probes ever separate two variants that a multi-turn probe cannot.

### PRB-02 · Commit result records and key them by content hashes
`accepted` · 2026-09-21 · `01a0c532`
**Decision:** Store every run in `probes/results/`, keyed by instruction-bundle hash, scenario definition hash including fixture bytes, model, judge model, and runner version. Reuse a record whenever the key matches and it holds enough trials. Rejected rerunning both variants on every invocation and keeping results outside version control.
**Why:** The recurring workflow is "I changed an instruction, what moved?", where the baseline was already measured. Hashing content rather than Git revisions means an unchanged baseline is reused across commits, while editing a scenario or fixture invalidates both sides automatically instead of silently comparing runs of different scenarios.
**Revisit if:** The instruction bundle grows beyond `shared/AGENTS.md` and per-file provenance becomes necessary.

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
