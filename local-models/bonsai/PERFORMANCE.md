# Bonsai 2 performance analysis

Findings through **2026-09-20** for the M4 Pro MacBook with 24 GiB unified memory.
This records profiling, the approved PI-76 runtime comparison, and PI-77 guarded
prewarming transfer measurements; it does not authorize further experiments or
runtime changes. [RESULTS.md](RESULTS.md) records the earlier coding trials;
[README.md](README.md) describes the installed setup.

## Current conclusion

**The tested full-harness configuration is functional but too slow for the user's
interactive workflow.** The earlier provisional “keep as an optional model” verdict
was based on successful bounded tasks. The user subsequently reported the latency
as unacceptable: “It seems to be way too slow.” Passing the tasks did not establish
practical usability.

**The newer official Prism runtime did not solve the latency problem.** In the
September 20 old → new → restored-old comparison, uncached first output took
**103.40 → 110.43 → 107.01 seconds**. The candidate passed bounded compatibility
and correctness checks, but these measurements give no performance reason to
promote it. The original runtime was restored as agreed.

**Full-profile prewarming transferred across fresh Pi sessions, but missed the
agreed five-second first-output target.** In PI-77, a separate **121.94-second**
warm-up reduced repair first output from **112.24 to 8.90 seconds** and total time
from **229.24 to 124.84 seconds**. The repair remained correct. Prism reused 8941
of 9501 input tokens; checkpoint placement prevented reuse of the entire matching
prefix. A separately approved stable-prefix native prefill then reduced first
output to **5.86 seconds from fresh Pi launch**, or **3.45 seconds from request
dispatch**, after a **110.21-second** warm-up. Neither fresh-launch result meets
the original five-second target, but the user subsequently accepted **5.86 seconds
as close enough**. This accepts the observed first-output latency, not unmeasured
repeatability or overall workflow performance. No startup automation was
implemented. See PI-77 below.

The dominant measured delay is processing the initial roughly 9K-token prompt.
Closing other applications eliminated observed swap-outs during the sampled
prefill window but left prompt throughput essentially unchanged. This weakens the
hypothesis that active swapping was the principal cause of the delay.

**GPU/kernel-side throughput is the leading explanation, not a proven hardware
classification.** CPU samples show waiting for Metal. We have not measured GPU
compute utilization or DRAM bandwidth, so compute-bound versus bandwidth-bound
remains unresolved. Paging and compression still occurred; disk I/O is not ruled
out as a contributor.

## Setup and measurements

Both profiles used the same running server process, Prism
`prism-b10683-d8f26ee`, Bonsai 2 27B PQ2_0, 24576-token context, one slot, 65/65
layers offloaded to Metal, and flash attention. No runtime, model, or server
configuration changed between runs. Both measurements ran on AC power: the
charger was reconnected before the second profile.

| Measurement | Before closing apps, Sep 19 UTC | After closing apps, Sep 20 UTC |
| --- | ---: | ---: |
| Actual input tokens, including template | 9012 | 9012 |
| Fresh request: first output | 107.64 s | 107.28 s |
| Server prompt-processing time | 107.13 s | 107.04 s |
| Server prompt throughput | 84.12 tok/s | 84.20 tok/s |
| Fresh request: generation throughput | 14.18 tok/s | 14.66 tok/s |
| Fresh request: total wall time | 125.62 s | 124.68 s |
| Repeated prefix: first output | 0.58 s | 0.60 s |
| Repeated prefix: cached input tokens | 9008 | 9008 |
| Repeated prefix: generation throughput | 14.50 tok/s | 13.73 tok/s |
| Repeated prefix: total wall time | 18.17 s | 19.18 s |

The repeated request skipped nearly all prompt computation. Its speedup proves
that prefix caching works; it does **not** prove that the GPU became faster or
isolate disk versus compute costs. Generation remained around 14 tokens/s.

### Memory and disk observations

These are **system-wide**, sampled over approximately 106 seconds of fresh
prefill, not process-attributed I/O measurements or exact request-boundary totals.

| Counter | Before | After closing apps |
| --- | ---: | ---: |
| Swap used at start of sampled prefill | 3500.94 MiB | 931.62 MiB |
| Swap used at end | 3785.06 MiB | 899.62 MiB |
| Swap-outs during sampled prefill | 332.12 MiB | 0 MiB |
| Page-ins | 8729.11 MiB | 7877.86 MiB |
| Compression activity | 15548.27 MiB | 8581.00 MiB |
| Decompression activity | 11143.33 MiB | 4629.39 MiB |
| Mean sampled disk transfer rate during prefill | 90.60 MB/s | 89.95 MB/s |
| Median sampled disk transfer rate during prefill | 42.52 MB/s | 5.19 MB/s |

Compression counts represent pages processed over time, potentially repeatedly;
they are not extra allocated memory. Page-ins include file-backed pages, not just
swap reads. Disk measurements include reads and writes from other processes.
A large mean with a much smaller median reflects bursts, not sustained saturation.

In the first prefill stack sample, **454 of 455 main-thread samples** were in
`ggml_metal_synchronize` → `MTLCommandBuffer waitUntilCompleted`. The second profile
also showed Metal waits dominating the main thread. Sampled process CPU-time
deltas averaged about **1.2% / 1.1% of one core** during prefill. Neither observation
means the GPU was necessarily compute-saturated: device memory stalls and driver
behavior can also present as a Metal wait.

## Method and limits

- Collected a 12-second idle baseline, then one fresh request and one identical
  repeated-prefix request, separated by eight seconds.
- Used a synthetic 595-row dataset with a fresh UUID near the beginning to avoid
  reusing the previous profile's prompt cache. `/tokenize` counted 9000 content
  tokens; the chat endpoint reported 9012 including template overhead. Both fresh
  requests reported zero cached tokens.
- Requested 256 output tokens, seed 75, temperature 0, and reasoning off to separate
  prefill from generation. `finish_reason: length` was expected at this deliberate
  profiling cap; it is unrelated to the earlier Pi truncation bug.
- Used native API streaming timings, roughly one-second `vm_stat`/`ps`/swap samples,
  `iostat`, and five-second process stack samples at 10 ms intervals.
- This synthetic API probe is not a Pi coding-quality test. It bypasses the Pi
  harness overhead but reproduces its approximate input size; it invokes no tools.
- Only one fresh/repeated pair was measured per condition. Different UUIDs, thermal
  state, background OS work, and instrumentation are uncontrolled factors.
- The second run followed overnight idle time. Idle server RSS was about 30 MiB,
  versus about 6052 MiB in the first profile. OS residency was therefore **not**
  held constant. “Fresh” means uncached prompt/KV state, not matched cold-disk or
  model-residency conditions. RSS also excludes some mapped/Metal accounting.
- Xcode Instruments was unavailable with the active Command Line Tools install.
  No GPU hardware counters were collected. We cannot assign a percentage of the
  delay to compute, memory bandwidth, page faults, or driver overhead.

The nearly identical prefill times are evidence against active swapping being
the dominant explanation in these two runs—not proof that memory pressure never
matters. The earlier assertion that this was simply “not disk I/O” was too strong.

## What has and has not helped

- **24K context:** resolved the observed response-headroom problem in the coding
  trials, not the initial latency. Pi 0.85.1's 4096-token safety reserve had clamped
  one 16K response to 347 output tokens. See [LLM-01](../../decisions/local-models.md).
- **Reasoning off:** shortened one full-harness explanation from 256 to 130 seconds,
  but that answer incorrectly denied the seeded bug. It did not remove the initial
  roughly 103-second prefill. It is not a validated blanket remedy.
- **Closing applications:** improved swap behavior, but did not materially improve
  prefill speed in the controlled repeat above.
- **Prefix reuse:** strongly reduced first-output latency for identical requests
  and, in PI-77, a different question from a fresh same-project Pi session.
  Prewarming moved most prefill before interactive use. Full-profile warm-up
  reached first output in 8.90 s; stable-prefix native prefill reached 5.86 s from
  Pi launch (3.45 s from dispatch). Neither fresh-launch result met five seconds.
  Available recurrent state/checkpoints, not just matching tokens, limit reuse;
  changed instructions/tools or eviction can invalidate it.
- **GPU offload and flash attention:** already enabled; this is not an accidental
  CPU-only deployment.

## PI-76 runtime comparison — September 20

The user approved downloading the newer runtime and temporarily restarting the
idle server, with restoration of the old runtime afterward. AC power was connected
before trials and checked before each profile/request and coding trial; retained
before/after captures also show AC. No global Pi configuration or routing changed.

GitHub still reported `prism-b10709-9a9394a` as the latest release and the official
demo pin on September 20. The standard macOS ARM64 archive (not the KleidiAI
variant) was 11,500,187 bytes; its SHA-256 matched the release asset digest:
`f9cdf245fb7b832f1996dd776b321d4ae1f23b6d88c380100f636742c3a980ff`.
The binary reported build 10709, commit `9a9394a89`. The unchanged model also
matched its recorded SHA-256. [Pin][pin], [release][release].

### Matched synthetic workload

Each phase restarted the server with the same arguments except its executable,
then ran the adapted historical collector: 12 seconds idle, one uncached request,
eight seconds pause, identical cached repeat, eight seconds cooldown. All three
request bodies were byte-identical, including the historical dataset UUID, seed
75, temperature 0, reasoning off and 256-token output cap. Restarting cleared
prompt-cache state; fresh requests reported zero cached tokens. This was not a
cold-disk experiment. The model checksum read preceded the first phase.

Logs confirmed 24576 context, one slot, 65/65 GPU layers, flash attention, the
same 6861.73 MiB Metal model buffer and 1536 MiB KV allocation. The instrumentation
remained native streaming timings, resource/disk samples and process stack samples.

| Measurement | Old, before | New | Old, restored |
| --- | ---: | ---: | ---: |
| Input tokens | 9012 | 9012 | 9012 |
| Uncached first output | 103.40 s | 110.43 s | 107.01 s |
| Uncached prefill | 87.17 tok/s | 81.62 tok/s | 84.23 tok/s |
| Uncached-request generation | 14.83 tok/s | 13.09 tok/s | 13.76 tok/s |
| Uncached request total | 120.59 s | 129.92 s | 125.54 s |
| Repeat cached input tokens | 9008 | 9008 | 9008 |
| Repeat first output | 0.59 s | 0.37 s | 0.49 s |
| Repeat generation | 14.64 tok/s | 14.02 tok/s | 14.51 tok/s |
| Repeat total | 18.01 s | 18.55 s | 18.07 s |

Every request generated 256 tokens and ended with the expected `length` stop.
The candidate's cached first output was quicker, but cached generation and total
time did not improve. Its fresh first output was 3.42–7.03 seconds slower than
the old-runtime observations. This is **no observed speedup**, not a statistically
established runtime regression: there was only one pair per phase, no randomized
order, and the candidate's coding checks preceded the restored-old measurement.
Background work, thermals and OS residency were not held constant.

System-wide sampled prefill swap-outs were zero in all three phases. Page-ins
were **381.98 / 5376.67 / 146.73 MiB**, and compression activity was
**281.56 / 1354.03 / 0 MiB**, respectively. These differences limit causal
attribution; the new run was not residency-equivalent to the old runs. No GPU
hardware counters or process-attributed disk I/O were collected. Compute versus
bandwidth remains unresolved, and disk contribution is not excluded.

### Candidate compatibility and correctness

- Native streaming, parsed `lookup_code` arguments, tool-result exchange and the
  final `CEDAR-4821` answer passed. Tool request first/total was **4.66 / 8.05 s**;
  its follow-up was **0.79 / 4.03 s**. The separate reasoning-off `OK` probe passed
  with no reasoning content (**0.84 / 0.92 s**).
- Full-harness explanation used normal extension discovery and existing guards,
  medium reasoning, the 512-token server reasoning budget and 2048-token completion
  ceiling. First/total was **120.20 / 231.27 s**. It correctly identified the dropped
  remainder and both failing tests, proposed the correct range, and left source
  and tests unchanged. Its expected post-trial result remained two failures.
- Full-harness repair used the same guarded settings: **115.26 / 220.83 s**. It
  reproduced the two failures, repaired the range with `edit`, wrote `NOTES.md`,
  and passed all five original tests without changing them. Independent parent-run
  validation passed 210 input/size combinations and three invalid-size cases.
- Both Pi trials ended with `stop`, not `length`, without timeouts or manual repair.
  The only repair tool error was the expected initial failing test run. All recorded
  assistant messages used `bonsai-local/bonsai-2-pq2`; neither trial delegated.
  Parent-side cloud log extraction and independent validation are not local-model
  performance. These checks do not repeat PI-75's three repairs and follow-up.
- Existing lexical guards stayed enabled; no OS confinement is claimed. No new
  deliberate guard-denial probe was run. Coding timings are compatibility evidence,
  not a matched old/new quality benchmark: only the candidate ran these two trials.

### Restoration and retained evidence

The old runtime is running again with the original arguments on loopback port
18080, PID **53471** at handoff, healthy with one idle 24K slot. It is a background
process, not reattached to the original terminal. The candidate remains downloaded
alongside it; `setup.sh`, `start.sh`, provider settings and routing were not changed.

All new raw captures, exact adapted collectors, trial fixtures and validation are
under [`local/profiling/2026-09-20-runtime-ab/`](local/profiling/2026-09-20-runtime-ab/).
The phases are `old-before/`, `new/`, and `old-restored/`; the live server log is
`old-restored/server.log`. `restoration.json` records the replacement PID.
Historical `local/logs/server.log` and `server-pid.json` were left untouched;
they do **not** describe this replacement process. Trial wrappers used isolated
log/PID paths. Startup/PID backups and pre-documentation source hashes preserve
the prior state. `validation.json` records matched-request, configuration,
local-only attribution, fixture and source-preservation checks. The one-off
orchestrator contains historical PIDs and single-use output paths; inspect and
adapt it rather than rerunning it blindly.

## Optimization candidates

Primary sources below were inspected on 2026-09-19–20 UTC. Except for the runtime
comparison and PI-77 prewarming measurements, these remain untested options, not
promised speedups or approved changes.

| Option | Evidence and assessment |
| --- | --- |
| Newer Prism runtime | **Tested in PI-76 above: no observed prefill or generation speedup.** The official pin remains `prism-b10709-9a9394a`. Its Metal tensor path is disabled by default on pre-M5 hardware; source comments report no significant difference on M4/M4 Max. The old runtime was restored. [Pin][pin], [release][release], [Metal checks][metal] |
| Startup prompt-cache prewarming | **Transfer tested in PI-77 below:** full guarded warm-up took 121.94 s and reached first output in 8.90 s. Stable-prefix native prefill took 110.21 s and reached 5.86 s from fresh Pi launch (3.45 s from dispatch). Fresh-launch latency still misses 5 s. No startup automation implemented. |
| Smaller guarded Pi profile | Less input should reduce prefill work. A dedicated local profile with fewer optional skills/tools is a direct candidate, but the resulting workflow differs from the normal harness. Retain the existing tool-call guard. No such final profile has been validated. |
| Lower prompt-cache RAM cap | Installed server help reports an 8192 MiB default cap. That is a limit, not a measurement of current use. A 1024 MiB cap is a possible test; it may reduce reuse across prompts. Not tested, and lower priority after closing apps failed to improve speed. |
| Bonsai 2 through MLX | The official demo launcher explicitly refuses serving Bonsai 2 through ordinary `mlx_lm.server` or `mlx_vlm.server`: they omit its custom Hadamard-aware loader and can silently produce wrong output. A bundled-loader one-shot path exists, but a Pi-compatible server is not a drop-in option. No MLX benchmark was run. [Launcher][mlx-server], [model card][mlx-card] |
| Quantized KV cache | Prism calls Q4 KV experimental and a memory tool, not a speed tool; decode is slightly slower than FP16. Do not assume it solves this latency problem. [KV guidance][kv] |
| Smaller model / another frontend | A smaller model with supported serving is a candidate for interactive use, requiring fresh correctness and tool-call trials. A frontend wrapping the same engine does not inherently accelerate its kernels. No alternative model or frontend was tested. |

The MLX model card's cross-platform throughput table reports **llama.cpp GGUF**
measurements, not MLX measurements. It is not evidence that switching this model
to MLX will improve this machine's performance.

## PI-77 guarded prewarming transfer — September 20

The user approved bounded request capture and inference trials, with **at most
five seconds to first nonempty thinking, tool-call or text delta** as the useful
interactive target. AC was reconnected and verified before and after every trial.
The installed Pi was now **0.86.0**, not the historical 0.85.1; therefore these runs
use a new matched baseline, not a cross-version performance comparison.

The old runtime stayed running as PID 53471 with the same 24K context, one slot,
GPU/flash-attention settings and 512-token reasoning budget. All Pi runs selected
`bonsai-local/bonsai-2-pq2`, medium reasoning and the existing 2048-token completion
ceiling. Normal tool, extension, skill and context discovery remained enabled.
No global settings, model configuration, subagent routing, instructions, guard
behavior or server arguments changed. No install or restart was performed.

### Actual rendered prefix and checkpoint limit

A process-local HTTP observer captured the actual outbound JSON, including all
seven tool schemas in their real order: `read`, `bash`, `edit`, `write`,
`ask_question`, `subagent`, `review_changes`. Prism's `/apply-template` rendered
those requests through the same parser as chat completions, without inference;
`/tokenize` with special-token parsing counted the rendered tokens. Counts for
live requests matched the server's prompt totals.

The embedded template renders **tool schemas first**, followed by tool-call
format instructions, Pi's system instructions/context/skills, the appended guard
instructions and session workspace, then the user message and assistant prefix.
Caching only the contents of `AGENTS.md` would not reproduce this prefix.
The two capture-only sessions shared 9355 tokens. The actual measured warm-up and
transfer shared **9354 tokens**, with identical tools and system text up to the
first differing token inside the sandbox's session UUID. The complete prompts
were 9457 and 9501 tokens. These counts are specific to this profile and fixture
path, not a universal shared-instruction size.

Prism can reuse a **partial** prefix, but Bonsai's hybrid/recurrent state needs a
compatible checkpoint. In the warm-up it saved checkpoints after **8941, 9436
and 9453 tokens**. The latter two were beyond the 9354-token common prefix and
could not be reused. The transfer log shows restoration at **8941**, leaving
**560 tokens** to evaluate: 413 matching tokens before the divergence plus 147
remaining tokens. That prefill took **8.21 seconds**, explaining most of the
8.90-second observed first-output delay.

This matches old-runtime source: `server-context.cpp` computes the common prefix,
searches eligible checkpoints, and forces full reprocessing when none is usable.
Checkpoint placement includes user-message boundaries and offsets of
`4 + n_ubatch` and `4` before prompt end; ordinary mid-prompt checkpoints are
skipped outside the relevant boundaries. With the observed 512-token microbatch,
9457 − 516 = 8941. Source inspected at `d8f26eec7`:
[restore rules][checkpoint-restore], [placement rules][checkpoint-placement],
[non-inference rendering/tokenization endpoints][template-endpoint].

### Trial method and results

All three runs started fresh Pi sessions in the **same disposable project
working directory**. The baseline repaired the established seeded `chunks` bug.
The separate warm-up loaded the entire guarded profile and asked only for `READY`.
The transfer session then received the repair question, **different from the
warm-up question**. Source/tests were reset to the original seed before each run;
no prior conversation was supplied. This is not identical-request repetition.

The baseline and warm-up explicitly set `cache_prompt: false` on their first
HTTP request, and both reported zero cached tokens. This made their prefill
uncached without restarting the server or claiming cold disk/model residency.
The transfer request used normal caching. Other sampling/reasoning parameters
were unchanged. Later tool-loop requests used normal caching in both repairs.

| Measurement | Uncached repair baseline | Separate full-profile warm-up | Fresh-session repair after warm-up |
| --- | ---: | ---: | ---: |
| First-request input tokens | 9501 | 9457 | 9501 |
| First-request cached tokens | 0 | 0 | 8941 |
| First nonempty Pi output | 112.24 s | 111.93 s | **8.90 s** |
| First text delta, possibly progress narration | 139.54 s | 121.86 s | 43.67 s |
| Total Pi wall time | 229.24 s | **121.94 s** | **124.84 s** |
| First-request prefill | 85.19 tok/s | 84.99 tok/s | 68.23 tok/s over 560 tokens |
| First-request generation | 14.02 tok/s | 13.90 tok/s | 14.04 tok/s |
| Generated tokens across the full run | 1420 | 140 | 1409 |

First-output and total timing start at Pi process launch. Request dispatch to
first Pi delta was 111.55 / 111.29 / 8.23 seconds, respectively. Decode across
each repair remained approximately **13.85 tokens/s**; the improvement came from
skipped prefill, not faster generation. Warm-up plus transfer cost **246.78 s**,
so this moves work before interactive use rather than reducing this single
repair's combined wait. Warm-up readiness was not automated.

Both repairs used read ×2, bash ×2, edit ×1 and write ×1. They reproduced the two
expected failing tests, fixed the range boundary, preserved all original tests,
wrote an accurate explanation in `NOTES.md`, and passed **5/5 tests**. Parent-run
validation independently passed **210 input/size combinations and three invalid
sizes for each repaired snapshot**. Both finished with `stop`, no timeout or
manual repair; all recorded assistant messages used the local provider/model.
The warm-up returned `READY`, used no tools and left the seeded bug unchanged
(the post-run test check therefore still failed as expected). No separate
explanation-only quality trial or new deliberate guard-denial probe was run.
Existing lexical guards were retained; this is not OS confinement.

### Memory, instrumentation and limits

Highest approximately one-second sampled server RSS was **2.78 / 2.78 / 2.93 GiB**
for baseline, warm-up and transfer. System swap stayed **867.62 MiB**, with zero
sampled prefill swap-outs. Sampled prefill page-ins were **144.28 / 118.27 /
14.33 MiB**; the windows differed greatly in length. `vmmap` physical-footprint
high-water readings were **3.4 / 3.4 / 3.5 GiB** for the same long-running process,
not independent per-trial peaks. RSS and footprint do not measure exact total
unified-memory use, and these samples do not isolate disk or GPU bottlenecks.

The initial capture-only observer failed because Pi's HTTP setup replaced global
`fetch` with npm undici's implementation. One unintended, unmeasured `READY`
request reached Prism before the 45-second capture timeout; the server completed
it afterward. The corrected observer retained interception through that
replacement. Two capture-only requests then returned a deliberate HTTP 400
without inference; server task ID remained unchanged. Measured baseline and
warm-up forced uncached prefill after this instrumentation failure. It is not
included in the timing table, but the trials were not cold-residency runs.

Only one baseline/warm-up/transfer sequence was measured. Background activity,
thermal state and sampling randomness were not controlled; no cache-eviction,
intervening workload, other-project or long-idle transfer was tested. Changing
instructions, schemas, ordering, project paths or date-dependent prompt text can
shorten the matching prefix. Cached instructions still occupy context and memory.
The existing server `--warmup` remains an empty run, not instruction prefill.

### Approved follow-on: stable-prefix native prefill

After the full-profile result, the user approved **one additional warm-up and
fresh-session repair**, aiming to leave reusable state closer to the changing
content. The native `/completion` payload used the first **9305 token IDs** of
the actual rendered guarded prompt, ending at `Session temporary workspace:`
before its path. These tokens were verified to be an exact prefix of the new
interactive request. This was not a replacement interactive system prompt:
the fresh Pi session still supplied all instructions, tools, guards and its
real workspace. The native warm-up invoked no tools.

The payload requested `cache_prompt: false` and `n_predict: 0`. The pinned
[server documentation][native-prefill] says zero prediction evaluates into cache
without generating text. **Observed behavior differed:** the server returned one
sampled token, ` /`, with `tokens_predicted: 1`. The collector's zero-generation
assertion failed; the response, timings and server log had already been saved.
Inspection confirmed the cache held exactly the 9305 prompt tokens, not an extra
evaluated generated token, before the authorized transfer proceeded. The source
samples/increments generation before checking the exhausted budget
([sampling][native-sampling], [limit check][native-limit]). Do not describe this
runtime's zero-prediction option as strictly generation-free or silently discard
that failed assertion. No runtime fix was attempted.

The warm-up created a checkpoint at 9301 as intended, but **the transfer did not
need to restore it**: it directly extended the live recurrent state at 9305.
Thus this validates native-prefix-to-chat transfer, not resilience of that
checkpoint after intervening generations or cache eviction.

| Measurement | Stable-prefix warm-up | Fresh Pi repair after prefill |
| --- | ---: | ---: |
| Input tokens | 9305 | 9502 |
| Cached tokens on first request | 0 | **9305** |
| Newly evaluated tokens | 9305 | **197** |
| Total wall time | **110.21 s** | **115.84 s** |
| First nonempty output from Pi launch | Not a Pi session | **5.86 s** |
| Request dispatch to first Pi delta | Not measured as streaming output | **3.45 s** |
| First text delta, possibly narration | Not a quality response | 46.95 s |
| Server prefill time | 110.20 s | **3.42 s** |
| Server prefill throughput | 84.44 tok/s | 57.58 tok/s |
| First-request generation throughput | One sampled token, no meaningful rate | 13.88 tok/s |

Pi spent **2.41 seconds before dispatch**, versus approximately 0.65 seconds in
the earlier sequence. This is observed launch-to-request time, not a diagnosis
of a particular extension. Model-response latency was below five seconds, but
**fresh-launch latency still missed the agreed target**; the timing origin was
not changed to claim success. An already-open interactive Pi session was not
measured. Full repair generation was 1313 tokens at roughly 13.76 tok/s. Different
output lengths and uncontrolled startup/OS state limit total-time comparisons.

The repair again reproduced two failures, fixed the range with `edit`, preserved
all five original tests, wrote the explanation and passed the tests. Independent
validation passed another **210 combinations and three invalid sizes**. The
six-completion workflow finished with `stop`; no timeout, delegation, unexpected
tool error or manual repair occurred. Medium reasoning, 512-token server budget and 2048-token
interactive ceiling remained intact. AC was verified before and after both runs.

Sampled peak RSS was **2.53 GiB** during native prefill and **2.87 GiB** during
repair; swap remained 867.62 MiB, with zero sampled swap-outs. Prefill page-ins
were approximately **3013.83 MiB** during warm-up and **18.55 MiB** during the
fresh-launch-to-first-output sampling window. The native run followed an
intervening idle period, so residency was not matched to the earlier sequence.
Both subsequent `vmmap` reports showed a process-lifetime 3.6 GiB footprint
high-water mark; this is not exact per-run unified-memory use.

**Result:** both full-profile and native stable-prefix warm-ups transfer to a
fresh guarded session. The user subsequently accepted the **5.86-second
fresh-launch first output** as close enough to the original five-second target:
“OK it's fine with this close to 5-second”. Repeatability remains unverified;
this does not establish acceptance of warm-up duration or total task time.
No further inference or startup automation is authorized by this report. Before
automation, validate repeated use, a clearly defined readiness boundary and
behavior after intervening requests or idle time. A smaller guarded profile/model
remains a separate option; these findings do not justify upgrading the runtime.

### User-run fresh-session check

The user reported that session `01a0c01a-fcdb-75cf-ba41-5662678c760d` appeared to work.
Its transcript confirms a fresh session in the same fixture, using
`bonsai-local/bonsai-2-pq2` with medium reasoning. It read source/tests, ran all
five tests successfully, and correctly explained retention of the final short
chunk. No edit or delegation was recorded. The transcript contains one user
question, not the two fresh sessions suggested for the manual check.

The live server log places its first request at task **4919**, approximately
**53 minutes after the preceding repair completed**, with no intervening
inference shown. It matched 9352 prefix tokens but restored the older checkpoint
at **8789**, confirming that useful cache state survived tool use and idle time.
The first request had **9470 input tokens**, of which **681** were recomputed in
**10.60 seconds**; generation was 14.25 tok/s. This validates partial cache
survival, **not repeatability of the accepted 5.86-second result**: the selected
slot fell back to 8789 rather than reusing the closer 9305-token boundary.

User-message to final-answer timestamps span approximately **67.20 seconds**.
The transcript does not retain streaming first-delta timing, so 10.60 seconds
is server prompt-processing time, not a measured UI first-output latency.
No new power or memory capture accompanied this manual observation. Evidence:
the session above and `old-restored/server.log` task 4919 in the PI-76 evidence
folder. This inspection issued no inference or cache-changing request.

Raw requests, rendered prompts/token IDs, scripts, events, per-phase server logs,
resource samples, source snapshots and independent validation are under
[`local/profiling/2026-09-20-prewarm/`](local/profiling/2026-09-20-prewarm/).
`analysis.json` contains the first sequence and pre-documentation preservation
hash checks; `analysis-after-aligned.json` adds the native-prefix transfer and
post-documentation checks. `PERFORMANCE.before.md` retains the prior report;
`PERFORMANCE.before-aligned.md` retains the first sequence's write-up. The server's live
log remains the PI-76 `old-restored/server.log`. Scripts contain fixed paths and
PID assumptions; inspect before reuse. Global settings, local models and routing
hashes matched before documentation; existing uncommitted source changes were
preserved. No cloud-worker output is credited as local performance.

## PTQ1_0 comparison (PI-85, 2026-09-21)

### Question, source, and controls

This run tested whether the official dense-trit PTQ1_0 packing improves speed or
memory on the same M4 Pro while preserving the existing Pi behavior. The tested
artifact was
`Ternary-Bonsai-2-27B-PTQ1_0.gguf` at Hugging Face revision
`6ed5e12bf84b7a63069882c91dd9e9218647d17b`, 5,946,648,928 published bytes,
SHA-256 `53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3`.
The PQ2_0 baseline at the same revision is 7,206,168,928 bytes. The official
[model card][bonsai-card] says PTQ1_0 is the memory-oriented packing, PQ2_0 has
faster prompt processing on every published platform, and only PQ2_0 has a
published Apple measurement. It also requires the Prism llama.cpp fork; stock
llama.cpp does not recognize either packing.

All three measurement phases used the M4 Pro MacBook Pro (`Mac16,8`), 24 GB
unified memory, macOS 27.0, AC power, Pi 0.86.1, and
`prism-b10683-d8f26ee`. Server controls were unchanged: 24,576-token context,
one slot, 65/65 Metal layers, flash attention, embedded Jinja tool template,
512-token reasoning budget, 2,048-token server completion ceiling, and thinking
sampling at temperature 1.0, top-p 0.95, top-k 20, and min-p 0.0.

The synthetic request used the same fixed 595-row content in every phase: 9,000
content tokens and 9,012 tokens after chat templating, 256 output tokens,
`reasoning_effort: none`, temperature 0, and seed 75. Each server was newly
started before its uncached request. The repeat sent the identical body to the
same server and reused 9,008 prompt tokens.

### Synthetic server timings

| Phase | Request | Cached tokens | First output (s) | Server prefill (tok/s) | Generation (tok/s) | Total (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| PQ2_0 initial | fresh | 0 | 95.31 | 94.58 | 15.27 | 112.01 |
| PQ2_0 initial | repeat | 9,008 | 0.62 | 6.83 for 4 new tokens | 15.93 | 16.62 |
| PTQ1_0 | fresh | 0 | 121.65 | 74.10 | 13.40 | 140.68 |
| PTQ1_0 | repeat | 9,008 | 0.65 | 6.43 for 4 new tokens | 13.23 | 19.93 |
| PQ2_0 restored | fresh | 0 | 100.46 | 89.72 | 15.24 | 117.20 |
| PQ2_0 restored | repeat | 9,008 | 0.52 | 8.03 for 4 new tokens | 15.32 | 17.16 |

PTQ1_0 was slower in both metrics that matter. Relative to initial/restored
PQ2_0, its fresh prefill throughput was 21.7%/17.4% lower and fresh generation
throughput was 12.3%/12.1% lower. Fresh first output was 27.6%/21.1% later and
total time was 25.6%/20.0% longer. Cached generation was 17.0%/13.7% lower, so
prefix reuse did not turn PTQ1_0 into the faster decoder.

The PTQ1_0 file is 17.5% smaller. Prism projected 7,298 MiB of device use for
PTQ1_0 versus 8,442 MiB for both PQ2_0 starts, a 1,144 MiB (13.6%) reduction.
Mapped model buffers were 5,660.56 MiB Metal plus 265.23 MiB CPU for PTQ1_0,
versus 6,861.73 MiB plus 322.07 MiB for PQ2_0. Context and compute allocations
were identical. Process RSS and `vmmap` residency varied with system paging and
do not provide a cleaner model-footprint comparison; system swap moved by
hundreds of MiB during phases and rose during the longer guarded trials.

These are native server timings, not full Pi-harness timings. “Fresh” means no
reused server prompt tokens after restart, not cold filesystem caches or cold
model pages.

### Compatibility and bounded Pi behavior

The PTQ1_0 native compatibility probe passed streaming, one parsed
`lookup_code({"label":"cedar"})` call, tool-result follow-up containing
`CEDAR-4821`, and a reasoning-free exact `OK`. Its tool/answer/off first-output
times were 4.90/0.78/1.01 seconds after the synthetic pair had populated the
server.

| PTQ1_0 Pi trial | First output (s) | Total (s) | Complete | Post-trial tests | Outcome |
| --- | ---: | ---: | --- | --- | --- |
| Explain, normal harness | 121.56 | 300.12 cap | No | Seeded failures remained, as expected for read-only explanation | Failed to produce a final answer; ended in another tool call after repeated reads and extra shell checks |
| Repair 1 | 25.36 | 133.04 | Yes | Pass | Correct fix and notes |
| Repair 2 | 8.04 | 87.57 | Yes | Pass | Correct fix and notes |
| Repair 3 | 8.69 | 109.38 | Yes | Pass | Correct fix and notes |
| Same-session follow-up on repair 1 | 2.91 | 104.26 | Yes | Pass | Added keyword-only strict mode and tests |

All three repairs used fresh seeded fixtures, reproduced the expected failing
tests, made valid local tool calls, passed the five fixture tests, and passed an
independent 210 input/size combinations plus three invalid-size cases. The
follow-up passed independent default, divisible-strict, and rejecting-strict
checks. No subagent was invoked or credited. The explanation did identify the
bug through tools, but its timeout, incomplete answer, and one avoidable failed
shell probe are a guarded-behavior regression for this run. Successful repair
samples do not establish broad model quality.

### Evidence and recommendation

Raw ignored evidence:

- initial PQ2_0: `local/logs/benchmark-pq2_0-20260921T062814Z/` and
  `local/logs/server-initial-pq2_0.log`
- PTQ1_0 synthetic/probe: `local/logs/benchmark-ptq1_0-20260921T063112Z/`,
  `local/logs/probe-ptq1_0-20260921T063423Z/`, and
  `local/logs/server-ptq1_0.log`
- PTQ1_0 Pi trials: `local/logs/ptq1_0-explain-pti7loe8/`,
  `local/logs/ptq1_0-repair-hhsmcjdf/`,
  `local/logs/ptq1_0-repair-shg498cv/`,
  `local/logs/ptq1_0-repair-1gr387mj/`, and
  `local/logs/ptq1_0-followup-5i19b9rw/`
- independent checks: `local/logs/ptq1_0-independent-validation.txt`
- restored PQ2_0: `local/logs/benchmark-pq2_0-20260921T064759Z/` and
  `local/logs/server-restored-pq2_0.log`

**Recommendation: retain PQ2_0.** PTQ1_0 saves about 1.1 GiB of projected device
memory, but this machine already fit PQ2_0 with the required context. In the
single matched sequence PTQ1_0 made both fresh prefill and decode materially
slower, made cached decode slower, and failed to complete the guarded normal-
harness explanation. Keep PTQ1_0 as an explicit experimental profile for cases
where the memory saving is itself required; do not make it the default or change
routing.

The sample is one synthetic pair per phase, one compatibility sequence, one
explanation, three repairs, and one follow-up. Background load, thermal state,
filesystem residency, memory compression, and system-wide swap were not
controlled. Sampling can alter full-harness trajectories. The restored baseline
bounds drift but does not eliminate it, and the bounded repairs are not a broad
quality benchmark.

## Evidence retention

Raw captures and the exact collector scripts have been copied out of the session
temporary workspace into ignored local storage:

- [`local/profiling/2026-09-19-before/`](local/profiling/2026-09-19-before/)
- [`local/profiling/2026-09-20-after-closing-apps/`](local/profiling/2026-09-20-after-closing-apps/)

Each directory contains `manifest.json`, `summary.json`, `resources.jsonl`,
`disk.jsonl`, prefill/decode stack reports, and `collector.py`. The first also
contains the derived `disk-summary.json`. Copies of the original captures were
SHA-256 compared before documenting them. Dates in stack reports use local time;
the directory names use UTC dates.

The archived collectors contain the measured PID and fixed output-directory
names; they record how these runs were performed, not a ready-to-run general
profiler. Raw captures remain machine-local and will not exist in a fresh clone.
The tracked tables above preserve the findings without requiring those files.
Neither historical profiling run changed server or Pi configuration. PI-76's
separate runtime restarts and restoration are recorded above.

[bonsai-card]: https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf/blob/6ed5e12bf84b7a63069882c91dd9e9218647d17b/README.md
[pin]: https://github.com/PrismML-Eng/Bonsai-demo/blob/17b143e889a45c090816b520e79a50c996164e1f/scripts/download_binaries.sh
[release]: https://github.com/PrismML-Eng/llama.cpp/releases/tag/prism-b10709-9a9394a
[metal]: https://github.com/PrismML-Eng/llama.cpp/blob/9a9394a/ggml/src/ggml-metal/ggml-metal-device.m#L1058-L1075
[mlx-server]: https://github.com/PrismML-Eng/Bonsai-demo/blob/17b143e889a45c090816b520e79a50c996164e1f/scripts/start_mlx_server.sh
[mlx-card]: https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-mlx-2bit/blob/main/README.md
[kv]: https://github.com/PrismML-Eng/Bonsai-demo/blob/17b143e889a45c090816b520e79a50c996164e1f/KV-CACHE.md
[checkpoint-restore]: https://github.com/PrismML-Eng/llama.cpp/blob/d8f26eec7/tools/server/server-context.cpp#L3101-L3270
[checkpoint-placement]: https://github.com/PrismML-Eng/llama.cpp/blob/d8f26eec7/tools/server/server-context.cpp#L3344-L3518
[template-endpoint]: https://github.com/PrismML-Eng/llama.cpp/blob/d8f26eec7/tools/server/server-context.cpp#L4931-L4989
[native-prefill]: https://github.com/PrismML-Eng/llama.cpp/blob/d8f26eec7/tools/server/README.md#L477-L517
[native-sampling]: https://github.com/PrismML-Eng/llama.cpp/blob/d8f26eec7/tools/server/server-context.cpp#L3718-L3759
[native-limit]: https://github.com/PrismML-Eng/llama.cpp/blob/d8f26eec7/tools/server/server-context.cpp#L1795-L1801
