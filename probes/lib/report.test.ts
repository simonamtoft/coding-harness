import { describe, expect, test } from "bun:test";

import { summarizeRecord, terminalSafe } from "./report.ts";

describe("terminalSafe", () => {
  test("escapes escape sequences and other control characters but keeps newlines and tabs", () => {
    expect(terminalSafe("ok\u001b[2J\u001b]52;c;aGk=\u0007\n\tdone\u009b")).toBe("ok\\u001b[2J\\u001b]52;c;aGk=\\u0007\n\tdone\\u009b");
  });
});
import { ZERO_USAGE } from "./transcript.ts";
import type { BenchmarkTrialRecord, JudgeVerdict, ProbeRecord, ProbeScenarioKind, RunTelemetry, TrialRecord } from "./types.ts";

const telemetry: RunTelemetry = {
  turns: 1,
  tools: {},
  assistantMessages: 1,
  messagesWithoutUsage: 0,
  usage: ZERO_USAGE,
  nestedToolUsage: ZERO_USAGE,
  compactions: [],
  providerRetries: 0,
  lastPromptTokens: 0,
};

const trial = (verdict: JudgeVerdict["verdict"], assertionsPassed: boolean | null, wallTimeMs = 0, usage = telemetry.usage): TrialRecord => ({
  trial: 1,
  assertions: assertionsPassed === null ? null : { passed: assertionsPassed, failures: [] },
  judge: { verdict, reason: "" },
  judgeEvidence: null,
  bashExecutions: [],
  finalMessage: "",
  wallTimeMs,
  telemetry: { ...telemetry, usage },
});

const ZERO_SPEND = "median agent wall 0.0m · median agent cost $0.00";

const base = {
  schemaVersion: 1,
  runnerVersion: "7",
  harnessMode: "isolated" as const,
  harnessHash: "h",
  runtimeHash: null,
  runtime: { piVersion: "0.87.1", bunVersion: "1.4.2" },
  scenarioId: "s",
  scenarioHash: "s",
  instructionsHash: "i",
  variantLabel: "candidate",
  model: "m",
  judgeModel: "j",
  createdAt: "",
  updatedAt: "",
  infrastructureFailures: [],
};

const record = (trials: TrialRecord[], scenarioKind: ProbeScenarioKind = "multi-turn"): ProbeRecord =>
  ({ ...base, scenarioKind, trials });

describe("summarizeRecord", () => {
  test("leads multi-turn cells with assertions and separates unparsed verdicts", () => {
    const summary = summarizeRecord(record([trial("pass", true), trial("fail", false), trial("unparsed", true)]));
    expect(summary).toBe(`assertions 2/3 (primary) · judge pass 1 fail 1 unparsed 1 · ${ZERO_SPEND}`);
  });

  test("labels single-turn cells as stated intent", () => {
    expect(summarizeRecord(record([trial("pass", null)], "single-turn")))
      .toBe(`judge pass 1 fail 0 unparsed 0 (stated intent only) · ${ZERO_SPEND}`);
  });

  test("omits judge counts for assertion-only probes", () => {
    expect(summarizeRecord({ ...base, scenarioKind: "multi-turn", judgeModel: null, trials: [trial("not_needed", true)] }))
      .toBe(`assertions 1/1 (primary) · ${ZERO_SPEND}`);
  });

  test("keeps a trial whose judge was unavailable and counts it apart", () => {
    expect(summarizeRecord(record([trial("unavailable", true), trial("pass", false)])))
      .toBe(`assertions 1/2 (primary) · judge pass 1 fail 0 unparsed 0 unavailable 1 · ${ZERO_SPEND}`);
  });

  test("counts judge calls skipped on a broken hard boundary apart from rulings", () => {
    expect(summarizeRecord(record([trial("skipped", false), trial("pass", true)])))
      .toBe(`assertions 1/2 (primary) · judge pass 1 fail 0 unparsed 0 skipped 1 (hard boundary broken) · ${ZERO_SPEND}`);
  });

  test("reports median agent wall time and cost, as a lower bound when usage is missing", () => {
    const summary = summarizeRecord(record([
      trial("pass", true, 60_000, { ...ZERO_USAGE, cost: 0.2 }),
      trial("pass", true, 120_000, null),
      trial("pass", true, 180_000, { ...ZERO_USAGE, cost: 0.4 }),
    ]));
    expect(summary).toEndWith("median agent wall 2.0m · median agent cost ≥$0.20");
  });

  test("shows infrastructure failures from this run apart from verdicts", () => {
    expect(summarizeRecord(record([trial("pass", true)]), 2))
      .toBe(`assertions 1/1 (primary) · judge pass 1 fail 0 unparsed 0 · ${ZERO_SPEND} · infrastructure failures 2`);
  });
});

describe("summarizeRecord for benchmarks", () => {
  const benchmarkTrial = (outcome: BenchmarkTrialRecord["outcome"], tokens: number, usageKnown = true): BenchmarkTrialRecord => ({
    trial: 1,
    outcome,
    exhaustedLimit: outcome === "budget_exhausted" ? "tokens" : null,
    repairRounds: outcome === "passed" ? 1 : 2,
    spent: { wallTimeMs: 1, tokens, costUsd: tokens / 100_000 },
    continuation: null,
    judgement: null,
    humanReview: null,
    rounds: [{
      round: 0,
      kind: "task",
      wallTimeMs: 1,
      telemetry: { ...telemetry, usage: usageKnown ? ZERO_USAGE : null },
      finalMessage: "",
      bashExecutions: [],
      artifacts: [],
      verifier: { exitCode: 0, output: "" },
    }],
  });
  const benchmark = (trials: BenchmarkTrialRecord[]) =>
    ({ ...base, judgeModel: null, scenarioKind: "benchmark" as const, contextWindow: 200_000, fixture: null, trials });

  test("leads with verifier outcomes and counts budget exhaustion apart from failure", () => {
    expect(summarizeRecord(benchmark([
      benchmarkTrial("passed", 10_000),
      benchmarkTrial("failed", 30_000),
      benchmarkTrial("budget_exhausted", 120_000),
    ]))).toBe(
      "verifier passed 1/3 (primary) · failed 1 budget exhausted 1 · repair rounds 1,2,2 · median tokens 30000 · median cost $0.30",
    );
  });

  test("counts continuation trials whose first phase left no handoff note", () => {
    const withHandoff = { ...benchmarkTrial("passed", 10_000), continuation: { handoff: "state" } };
    const withoutHandoff = { ...benchmarkTrial("failed", 10_000), continuation: { handoff: null } };
    expect(summarizeRecord(benchmark([withHandoff, withoutHandoff]))).toContain("repair rounds 1,2 · handoff missing 1 ·");
  });

  test("marks spend as a lower bound when usage was missing", () => {
    expect(summarizeRecord(benchmark([benchmarkTrial("passed", 10_000, false)])))
      .toContain("median tokens ≥10000 · median cost ≥$0.10");
  });
});
