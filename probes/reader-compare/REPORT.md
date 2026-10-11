# Haiku 5.5 vs Luna for Pi's bulk-reader

**Decision for now: keep Luna as the default; test Haiku in a parent workflow before changing the pin.** In this worker-only comparison, Haiku much more often supplied citations matching the answer key. It also had higher reported worker cost and slower median completion, and occasionally skipped the mandatory brief read or searched beyond the supplied files. The result supports a targeted follow-up, **not** a claim that switching will reduce total workflow cost.

**Run:** 8 October 2026 · Pi 1.0.4 · batch `f8e91b5a3c02fdc0` · four fixed tasks × ten paired repetitions = **40 completed runs per model**, plus one retained Haiku timeout/retry. The runner, prompts, source SHA-256s, answer key and scoring checks are in [`cases.json`](cases.json) and [`run.py`](run.py); [README.md](README.md) explains reproduction and data handling. Results below were computed from local untracked records using `summary.py` with offline scorer version 2 and audited against the pinned source files. The installed Pi later updated to 1.1.0; reproducing this exact batch requires Pi 1.0.4, while a new run gets its own batch identity. Raw model replies are **not** in this report.

## Results

| Assignment | Luna strict citation candidates | Haiku strict citation candidates | Median reported cost per run, Luna / Haiku | Median wall time, Luna / Haiku |
| --- | ---: | ---: | ---: | ---: |
| Large code file: stream events and usage | 2/30 | 27/30 | $0.00256 / $0.00605 | 10.9s / 14.3s |
| Large document: benchmark records and guard rule | 0/30 | 30/30 | $0.00217 / $0.00612 | 10.6s / 16.4s |
| Small multi-file: model and answer contract | 11/30 | 29/30 | $0.00158 / $0.00410 | 11.7s / 16.5s |
| Decision history: SUB-14/16/19 | 2/30 | 25/30 | $0.00131 / $0.00397 | 10.0s / 12.8s |
| **All four** | **15/120** | **111/120** | **$0.07781 / $0.20207 total** | **10.7s / 15.5s median run** |

A *strict citation candidate* has the expected terms in its labelled answer and a source path and narrow line range covering the keyed line(s). It is **not a measured accuracy rate**. Both models generally supplied the requested factual content (expected terms in labelled answers: Luna 117/120, Haiku 120/120); the prominent separation was citation support. All completed replies had the three required answer sections. Luna's first tool call loaded the installed brief in 40/40 runs and used only the allowed sources in 40/40. Haiku did so in 37/40 each: three small multi-file runs skipped the first-read requirement, and three searched outside the explicit file list (two of those did both). Both used read-only tools.

**Audit of the proxy:** I inspected all nine Haiku citation-candidate misses and Luna's 15 candidate positives, plus passing examples across all four tasks. Four Haiku misses used “same file” without repeating the source path within that labelled answer; the other five gave correct source locations in a format the strict parser did not accept (e.g. “lines 89 (heading) to 91 (Decision),” a push line instead of its guard line, or separate numbered lines). The sampled positives matched the inspected source passages. The proxy also undercounts Luna: one reply cited two correct ranges in a single line that its parser did not bind to both key lines. Conversely, terms and line numbers alone cannot prove a claim true, and the entire set of 240 answers was **not** independently human-labelled. For an example of a real citation failure, a Luna reply placed `tool-call-recon` at `probes/README.md:437–438`; the recorded pass counts are at **line 387**. In another it cited SUB-14 at `decisions/subagents.md:72–73`; its decision is at **line 91**. Haiku also sometimes added unnecessary claims about coverage beyond the questions; those are not scored.

## Cost and scope

Across completed runs, Pi reported **$0.27988** of worker usage ($0.07781 Luna, $0.20207 Haiku): Haiku cost **2.6×** as much here. Its median run took **15.5s vs 10.7s**. The stalled Haiku attempt had no reported assistant usage; it consumed about 180 seconds, was retained as an infrastructure failure, and was retried successfully once. It is excluded from completed-run medians, not hidden as a quality failure. The $5 stop limit was not reached. These are Pi's **model-usage estimates**, not subscription charges or invoices; token counts, reasoning output, cache writes, prompt caching and provider billing differ even when published short-prompt input/output rates match. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) and [OpenAI pricing](https://developers.openai.com/api/docs/pricing) were accessed on 8 October 2026.

All tasks use this public repository's files, so possible training contamination and repeated prompts limit generalization. Ten runs of each of **four tasks** are not 40 independent tasks; the per-fact counts are even more correlated. The script uses the bulk-reader brief, tools, low thinking setting, and the same child Pi flags as the runtime, but launches children directly: it does **not** measure whether a parent trusts, rereads, repairs, or benefits from their answers. Local model overrides and actual provider billing are not represented. Do not use these numbers to claim an end-to-end economic win or a universal best model.

**Next decision gate:** If the team values precise source citations enough to pay more for this worker, run a small whole-workflow A/B with the same parent tasks and measure verified parent answer quality, rereads, combined usage and latency. Keep canonical pins unchanged until that result supports a switch. If cost is the priority, first test whether a narrow citation-verification instruction or tool affordance improves Luna's line locations without its parent having to reread everything.

## Parent-workflow follow-up (PI-99, 8 October 2026)

**Result: no switch.** A slim parent A/B did not show a workflow benefit from Haiku large enough to change the `bulk-reader` pin. Treat it as a smoke test, not a ranking: **2 tasks × 3 paired repetitions = 6 runs per arm**, one Sonnet 5.5 parent (medium thinking, `read,grep,find,ls,subagent`), identical prompts, with only the worker model changed. The parent was told to delegate first and not read the source beforehand. The Luna arm ran on `PrivateGPT/gpt-6-luna` because the `openai-codex` login expired mid-run, so it is not the canonical `openai-codex` route.

| | Luna (PrivateGPT) | Haiku 5.5 |
| --- | ---: | ---: |
| Final parent answers factually correct | 6/6 | 6/6 |
| Combined parent + worker reported cost, all runs | $0.178 | $0.181 |
| Worker-only reported cost | $0.020 | $0.035 |
| Median wall time, event task / record task | 19.6s / 26.7s | 24.5s / 33.2s |
| Parent source reads after delegation (record task) | 2, 1, 4 | 2, 1, 2 |

- **Accuracy:** every final answer was correct on both arms. Worker line numbers were sometimes wrong on both. On the 726-line README task the parent re-read and corrected them in most runs. Haiku's better worker-level citations therefore did not become better final answers here.
- **Cost:** combined cost was effectively tied (+2% for Haiku). Haiku's higher worker cost was offset by slightly fewer parent re-reads, but three runs per task cannot separate that from noise.
- **Latency:** Haiku was about 25% slower per run.
- **Excluded events, kept locally:** one early Luna timeout, one `openai-codex` authentication failure, and one run where the parent's first worker call lacked the question (the parent retried successfully; counted but flagged). The worker model was verified against the requested pin in every counted run.

**Recommendation:** keep Luna as the canonical `bulk-reader` model. Revisit if reading assignments are long enough that parent rereads dominate cost, or if the team decides worker citation precision is worth roughly 2× worker cost and slower runs. Other Luna roles were not tested.
