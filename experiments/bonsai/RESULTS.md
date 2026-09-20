# PI-75 trial results — 2026-09-18–19

**Historical trial verdict: keep as an optional, supervised local model; not a
default replacement.** Subsequent use established that the latency is too high
for the user's interactive workflow. See [PERFORMANCE.md](PERFORMANCE.md) for the
September 19–20 profiles, updated assessment, and optimization candidates.

The final **24K + medium reasoning + normal guards** profile produced a complete
bug explanation, passed three clean repairs, and passed the same-session follow-up
without manual repair. The follow-up required one model-driven test correction.
Fresh full-harness sessions still took **110–125 seconds to first output**;
repairs took **198–208 seconds**, and the follow-up took **232 seconds**.
Latency acceptance by the user and readiness for unattended work are not established.

Earlier 16K and reasoning-off failures remain below as evidence, not current
recommendations. The final 24K results are at the end of this report.

## Initial 16K environment and setup

- M4 Pro, ARM64, 24 GiB unified memory; macOS 27.0 (`26A428`); Pi 0.85.1.
- Official demo-pinned Prism `prism-b10683-d8f26ee`, build 10683,
  commit reported by binary: `d8f26eec7`. No source build needed.
- PQ2_0, 7,206,168,928 bytes; model revision and both verified SHA-256 values are
  in [README.md](README.md) and `setup.sh`. Setup rerun verified existing files.
- Initial download was interrupted by the operator's 30-second command timeout;
  resumed successfully. This was setup retry, not a model/tool failure.
- Manual server: `127.0.0.1:18080`, 16384-token context, one slot, 65/65 layers
  offloaded to GPU, flash attention, embedded Jinja template, 512-token reasoning
  default, 2048 requested output tokens per completion. No vision or speculation.
- Native health, streaming, parsed tool call, tool result, and answer passed.
  A synthetic lookup returned `CEDAR-4821`, which appeared in the final answer.
- Native `reasoning_effort: none` and Pi `--thinking off` both returned `OK` with
  no thinking content. Pi medium requests activated the server's 512-token budget.
- Configuration merge preserved existing model-config values. The original backup
  is machine-local: `~/.pi/agent/models.json.pi75-20260918T134006Z.bak`.
  `settings.json` remained last modified on 2026-09-16, before these trials;
  default provider/model remained `IM-GPT` / `gpt-5.6-terra`.
- CORS initially used the server default. Before repair 3 and the normal-harness
  trial, startup was tightened to its own loopback origin and the UI/server agent
  disabled. An external-origin preflight did not receive an allowing origin.

## Initial 16K trial outcomes

First output includes thinking or tool-call deltas, not necessarily user-facing
answer text. Total is Pi wall time, including tools and startup. Every trial had
a 300-second process cap; none reached it. No human edited trial fixtures.

| Trial | First output | Total | Result |
| --- | ---: | ---: | --- |
| Basic explanation, uncached fixture prompt | 19.25 s | 80.26 s | Correctly identified the two failing cases; files unchanged |
| Repair 1, warm shared prompt | 6.63 s | 80.40 s | 5/5 tests passed; read/bash/edit/write worked |
| Repair 2, new clean fixture, warm server | 8.09 s | 95.92 s | 5/5 tests passed; read/bash/edit/write worked |
| Repair 3, new clean fixture, restarted server | 18.04 s | 100.89 s | 5/5 tests passed; read/bash/edit/write worked |
| Follow-up to repair 1, same session | 1.71 s | 262.41 s | 11/11 tests passed after self-recovery |
| Normal-harness explanation | 100.88 s | 255.86 s | Identified bug, but final response ended mid-table with `stopReason: length` |

The seed drops the short final chunk, including input shorter than `size`.
Each repair reproduced exactly two expected failing tests before fixing the
range boundary. Original tests were left intact. No repair trial had an
unexpected tool error or needed a second fix attempt.

The follow-up added keyword-only `strict=False` and divisibility validation.
It had **two exact-text edit failures** and introduced a syntax mistake in an
intermediate edit. The model noticed the mistake and recovered with full-file
writes before testing. These are real tool/recovery costs, despite the final pass.

The normal-harness trial used read twice and bash four times. It first invoked
`unittest.main` with a filename where a module name was needed, then corrected
that command. The subsequent two failing tests were expected: explanation was
not allowed to repair the fixture. Its final answer was incomplete even though
Pi exited 0. The server reported no context truncation (final prompt 11980 tokens,
347 generated tokens). Subsequent diagnosis identified Pi's output-budget clamp:
`16384 - 4096 safety reserve - (11509 prior usage + 432 estimated trailing tokens)
= 347`. Installed Pi 0.85.1's `clampMaxTokensToContext` in bundled
`chunk-AXIIZGTV.js` applies this before the API request. Recomputing the budget
from the actual transcript reproduced 347 exactly (`length-diagnosis.json`).
Increasing `maxTokens` alone cannot defeat this context-headroom clamp.

Additional parent-run validation checked 210 default input/size combinations per
repaired fixture, invalid sizes, and 210 strict-mode combinations on the follow-up.
All passed. This is a tiny Python fixture, not evidence about large repositories.

## Initial 16K latency, throughput, and memory

- First server startup to listening: **8.04 s**. Restart: **1.34 s** with warm OS
  file caches. No cache flushing or reboot was performed, so neither measures a
  guaranteed cold-disk load. Repair 3 is cold server/KV state, not cold disk.
- Initial native tool request: first output **4.17 s**, total **7.32 s**.
  Its tool-result follow-up: **0.67 s / 3.71 s**. Native reasoning-off: **0.71 s /
  0.77 s**. These small prompts are not comparable to a full harness prompt.
- Server-log weighted prompt throughput: **74.6 tok/s** before restart and
  **87.5 tok/s** after; generation **15.0 / 15.2 tok/s**. These aggregate the
  probe/trial completions in each server run, include cached-prefix behavior,
  and are not standardized `llama-bench` results.
- The normal harness's initial prompt was **9361 tokens**; its first output took
  about **101 seconds**. Baseline explanation started at **1603 prompt tokens**.
  Prompt-processing overhead is material on this machine.
- Highest 1-second sampled server RSS: **9,470,640 KiB (9.03 GiB)** during the
  normal trial. RSS fluctuated greatly and does not capture all mapped/Metal
  residency. `vmmap` physical-footprint high-water readings were 4.0 GiB for the
  first process and 2.7 GiB for the restarted process; these are a different
  accounting measure, not interchangeable peak-total-memory estimates.
- Startup reported 6861.73 MiB MTL model buffer, 1024 MiB KV cache, 149.62 MiB
  recurrent state, and 183.28 MiB MTL compute buffer, plus CPU buffers. These are
  allocations, not an independently measured peak unified-memory total.
- System swap was **0 MiB before startup**. Observed peak during trials was
  **3744.25 MiB**; it was 3472.25 MiB at normal-trial completion. Other applications
  were active, and no quiet-machine baseline was enforced. Do not attribute the
  entire increase to Bonsai. Short peaks between samples may be missed.

## Harness scope and routing

The initial basic trials disabled extension, skill, prompt-template, and context
discovery, **including the tool-call guard**. They are unguarded historical
measurements, not proof of guarded performance. The initial normal trial retained
discovery and inherited this checkout's instructions.
It demonstrably reacted to those instructions, but did not exercise every
extension, skill, permission dialog, or subagent. Trial prompts prohibited
delegation, and all recorded assistant messages were `bonsai-local/bonsai-2-pq2`.

Current local subagent overrides route bulk-reader, repository-scout,
test-log-analyst, and presenter to `IM-GPT/gpt-5.6-luna`, correctness-reviewer to
`openai-codex/gpt-5.6-terra`, and security-reviewer to `IM-GPT/gpt-5.6-sol`.
The implementation-worker definition is pinned to `openai-codex/gpt-5.6-terra`.
These do not inherit Bonsai. Parent-side log extraction and implementation review
used non-Bonsai workers and are **not** credited as local-model capabilities.
No model-routing policy was changed.

## Evidence and next decision

Ignored raw evidence lives under `local/logs/`: `probe-*.json`, `pi-off.jsonl`,
`server-first.log`, `server-baseline2.log`, `server-tuning16k.log`,
`server-24k.log`, `throughput.json`, `defaults-evidence.json`,
`independent-validation.json`, and per-trial event/summary/test files. Trial IDs:

- `explain-oau5esxy` — baseline explanation
- `repair-x0m07pnl`, `repair-vmab010n`, `repair-ymr_qxu2` — repairs 1–3
- `followup-lptxiojk` — follow-up
- `explain-3wzfx6lo` — normal harness

The current runner additionally captures file snapshots, server-log excerpts, and
`vmmap` output; the first five trials predate those additions. Their event logs
and fixture directories remain available. The follow-up changed repair 1's final
fixture, so its original repair is evidenced by its earlier event/test logs.

Keep this separate setup as an optional model, not as a default. The length stop
is diagnosed above, and the user subsequently approved the 24K trial below.
A quieter-machine repeat remains useful; no global harness or routing changes
are part of this experiment. Initial native probe records are retained under
`local/logs/probe16k/`; the 24K rerun is preserved under `local/logs/probe24k/`.
Top-level `probe-*.json` and `server.log` are working files for future runs.

## Guard review and tuning boundary

Correctness review found no actionable defects. Security review identified that
`--no-extensions` removed the guard from baseline trials and that generated tests
run with host privileges. The user chose existing Pi protections rather than a
new OS sandbox (SBX-20). The runner now explicitly loads the guard in minimal
trials and retains normal discovery in full-harness trials. A live Bonsai guard
probe attempted a `read` outside its fixture and received `Sandbox blocked tool
call: ... outside reads require interactive approval` (`guard-check.jsonl`).
This verifies actual guard dispatch, not merely a command-line flag.

The residual limitation is deliberate: lexical tool-call inspection cannot
confine generated Python or other subprocesses. Operator-run post-trial tests
also remain outside that inspection. Use only trusted fixtures; stronger
isolation is separate work. No claim of OS confinement is made.

## Reasoning-off tuning, with guards retained

These fresh full-harness runs changed only reasoning mode, keeping 16384 context,
the normal tool set/instructions, and existing sampling settings. The latter are
the thinking-mode sampler values, not the model card's alternate non-thinking
sampler; this is a single-variable comparison, not an exhaustive off-mode test.

| Trial | First output | Total | Completion and correctness |
| --- | ---: | ---: | --- |
| Explanation (`explain-axuoez21`) | 103.34 s | 129.66 s | `stop`, but **incorrect**: claimed no mismatch and that all tests pass |
| Repair (`repair-mmj3pcnn`) | 102.66 s | 153.36 s | `stop`; reproduced 2 failures, fixed the range, 5/5 tests passed |

Explanation used read twice and did not run the tests. Its claim that
`range(0, len(items) - size + 1, size)` keeps the remainder is false. This faster,
complete response is not a successful correctness result. The repair used
read ×2, bash ×2, edit ×1, and write ×1; its only failing tool result was the
expected initial regression run. The parent verified the actual corrected
source and that the original tests were unchanged. No manual repair was needed.

Peak sampled server RSS was 6,650,592 KiB for explanation and 6,266,640 KiB for
repair. Swap began at 2888.25 MiB and ended at 2856.25 MiB across these runs; neither
run increased it above its starting value. Background workloads remain uncontrolled.

Reasoning-off reduced generation/workflow time but did not remove the roughly
103-second initial prefill. It cannot yet be recommended as a blanket replacement
for medium thinking: one static explanation failed even though test-driven repair
succeeded. The current runner records `final_stop_reason` and `answer_complete`
separately from process exit; correctness still requires inspecting the answer
and tests. Local checks after the guard change: 107 sandbox tests and 5 provider
merge tests passed.

## 24K with reasoning — 2026-09-19

The user approved increasing both the server context and the separate local Pi
model's `contextWindow` to **24576**, preserving medium reasoning, the normal
harness, guards, 512-token server reasoning budget, and 2048-token requested
completion ceiling. Pi remained 0.85.1. This is the current tracked profile.
Only the local model's context field changed in `models.json`; its previous
configuration was backed up as `models.json.pi75-before24k-pgse0yev.bak`.

Health/props confirmed one slot and 24576 context; the log confirmed 65/65 GPU
layers. Native streaming/tool-result round-trip and reasoning-off probes passed
again: tool first/total **5.23 / 8.24 s**, tool-result follow-up **0.71 / 3.74 s**,
off **1.02 / 1.10 s**. Binding remained loopback-only.

All following trials used **normal extension discovery, guards, medium reasoning,
and disposable fixtures**. All completed below the 300-second cap, ended with
`stop` rather than `length`, and required no manual intervention.

| Trial and evidence directory | First output | Total | Result |
| --- | ---: | ---: | --- |
| Explanation: `explain-9qo9c8a9` | 110.05 s | 199.29 s | Correctly identified the range bug and both failing cases; no edits |
| Repair 1: `repair-ex4i5cbt` | 109.61 s | 200.16 s | 5/5 tests passed |
| Repair 2: `repair-xqaiy03r` | 124.63 s | 208.02 s | 5/5 tests passed |
| Repair 3: `repair-jqvfa8y3` | 116.16 s | 198.28 s | 5/5 tests passed |
| Follow-up to repair 1: `followup-zpj2ivpx` | 3.21 s | 232.10 s | 10/10 tests passed after correcting one generated test |

Each repair used read ×2, bash ×2, edit ×1, and write ×1. The only failing command
was the expected two-failure regression run before the fix. The parent verified
that all three repaired sources contained the correct range and all original
tests were unchanged. The follow-up used read ×2, write ×1, edit ×2, and bash ×2.
Its first new keyword-only test supplied `True` as `size`, not as an extra
positional argument; the model corrected that test and reran successfully.
There were no tool parsing failures, exact-match edit failures, guard denials,
or delegation in these coding trials. The separate deliberate guard probe remains the denial test.

The explanation's core analysis was correct, but it incorrectly referred to a
“docstring's own example” that does not exist. Completed output is not a guarantee
that every prose claim is accurate. Parent-run validation independently passed
210 default cases plus invalid-size checks on each of the four repair/follow-up
snapshots, and 210 strict-mode cases on the follow-up
(`independent-validation-24k.json`).

Observed resource/timing evidence:

- Startup was healthy within **8.10 s** (one-second polling; not cold-disk timing).
- KV allocation increased from **1024 to 1536 MiB**. Model weights did not change.
- Highest sampled server RSS across the five trials: **6,209,824 KiB (5.92 GiB)**.
  `vmmap` reported a **4.4 GiB physical-footprint high-water mark**. These measures
  do not capture an exact peak unified-memory total and cannot establish that
  24K uses less memory than 16K; workload and residency differed between runs.
- Observed swap started at **3009.75 MiB** for explanation, reached
  **3932.94 MiB** by repair 1 after the intervening native probes, and ended at
  **3636.94 MiB** after repair 3. No quiet-machine control was imposed.
- Across 29 native/trial completions, server-log weighted throughput was
  **79.39 prompt tok/s** and **13.27 generation tok/s** (`throughput-24k.json`).
- Fresh fixture sessions still paid the large initial prompt cost. Same-session
  follow-up reused context and reached first output in **3.21 s**, but generation,
  edits, and the corrected test still took nearly four minutes overall.

The additional context removed the observed headroom failure in this bounded
trial set without turning reasoning off. It does not remove Pi's 4096-token safety
reserve or prevent eventual context pressure in longer sessions. No compaction,
large-repository work, or autonomous delegation was validated. The server was
stopped at the original handover; manual startup is described in README.md. The optional
provider remains configured, with global defaults and routing unchanged.
