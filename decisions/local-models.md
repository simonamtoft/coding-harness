# Local model experiments

Decision ledger area. Entry ids use the `LLM-` prefix; see `../DECISIONS.md` for the format and append rules.

`experiments/`

### LLM-01 · Keep Bonsai reasoning and increase matched context to 24K
`accepted` · 2026-09-19 · `01a0b4b8`
**Decision:** Use matching 24576-token server and local-provider limits for the PI-75 Bonsai profile, retaining medium reasoning and existing Pi guards. Do not use reasoning-off as the blanket remedy for the initial 16K truncation, and do not change global defaults or subagent routing.
**Why:** Pi 0.85.1's 4096-token safety reserve clamped a normal-harness response to 347 output tokens despite a 2048-token configured ceiling. Raising that ceiling alone would not help. Reasoning-off completed faster but missed the seeded bug in explanation; the approved 24K trial preserved reasoning and completed the explanation, three repairs, and follow-up. This addresses the observed headroom failure, not the long initial prefill or eventual context pressure.
**Revisit if:** Pi changes its context-budget calculation, a materially smaller guarded harness is chosen, or measured memory pressure makes 24K impractical.
**Evidence:** "Test 24K with reasoning"

### LLM-02 · Do not promote Prism b10709 as a Bonsai latency fix
`rejected` · 2026-09-20 · `01a0bee8`
**Decision:** Leave `prism-b10683-d8f26ee` as the active Bonsai runtime after the approved PI-76 comparison. Keep `prism-b10709-9a9394a` only as a local candidate; retaining an upgrade requires a separate user decision.
**Why:** The matched old → new → restored-old probe reached uncached first output in 103.40 → 110.43 → 107.01 seconds, with no generation improvement. Native tool exchange and bounded guarded correctness passed, but compatibility alone does not address the user's unacceptable latency. One pair per phase and unequal paging/residency do not establish a general runtime regression. See `experiments/bonsai/PERFORMANCE.md` for measurements and limits.
**Revisit if:** A newer runtime or repeated controlled evidence establishes a useful gain, another concrete benefit warrants the upgrade, and the user authorizes retention.

### LLM-03 · Accept the measured 5.86-second prewarmed first output
`accepted` · 2026-09-20 · `01a0bf5d`
**Decision:** Treat PI-77's observed 5.86 seconds from fresh Pi launch to first output as acceptable, rather than rejecting it for exceeding the original five-second target. This acceptance does not authorize startup automation, further inference trials, configuration changes or routing changes.
**Why:** Stable-prefix prefill reused 9305 of 9502 tokens while retaining the complete interactive guarded profile. First output took 3.45 seconds after dispatch plus 2.41 seconds before dispatch; the repair passed the original tests and independent checks. The user accepted the small target overrun. One observation does not establish repeatability, and acceptance of first-output latency does not imply acceptance of the separate 110.21-second warm-up or 115.84-second total repair time.
**Revisit if:** Repeated measurements or real use show materially different first-output latency, correctness or guard behavior, or the user changes the acceptance criterion.
**Evidence:** "OK it's fine with this close to 5-second"

### LLM-04 · Retain PQ2_0 over PTQ1_0 on the M4 Pro
`accepted` · 2026-09-21 · `01a0c29d`
**Decision:** Keep PQ2_0 as the Bonsai experiment baseline. Retain PTQ1_0 only as an explicit experimental profile for situations where its smaller footprint is required; do not make it the default or change routing.
**Why:** In the matched PQ2_0 → PTQ1_0 → restored-PQ2_0 sequence, PTQ1_0 reduced projected device use by 1,144 MiB but reduced fresh prefill throughput by 17–22%, fresh decode by about 12%, and cached decode by 14–17%. It also timed out without a final answer in the guarded normal-harness explanation, although native compatibility, three repairs, and the same-session follow-up passed. The existing 24 GB setup already fits PQ2_0, so the memory saving does not compensate for slower prefill and decode plus the observed behavior failure. See `experiments/bonsai/PERFORMANCE.md`.
**Revisit if:** A newer compatible Prism runtime materially improves PTQ1_0 on Apple Silicon, memory pressure prevents PQ2_0 from running the required context, or repeated controlled trials overturn the speed or guarded-behavior result.
