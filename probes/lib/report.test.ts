import { describe, expect, test } from "bun:test";

import { summarizeRecord } from "./report.ts";
import type { JudgeVerdict, ResultRecord, TrialRecord } from "./types.ts";

const trial = (verdict: JudgeVerdict["verdict"], assertionsPassed: boolean | null): TrialRecord => ({
  trial: 1,
  assertions: assertionsPassed === null ? null : { passed: assertionsPassed, failures: [] },
  judge: { verdict, reason: "" },
  judgeEvidence: null,
  bashExecutions: [],
  finalMessage: "",
});

const record = (trials: TrialRecord[]): ResultRecord => ({
  runnerVersion: "5",
  harnessMode: "isolated",
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
  trials,
  infrastructureFailures: [],
});

describe("summarizeRecord", () => {
  test("leads multi-turn cells with assertions and separates unparsed verdicts", () => {
    const summary = summarizeRecord(record([trial("pass", true), trial("fail", false), trial("unparsed", true)]), "multi-turn");
    expect(summary).toBe("assertions 2/3 (primary) · judge pass 1 fail 1 unparsed 1");
  });

  test("labels single-turn cells as stated intent", () => {
    expect(summarizeRecord(record([trial("pass", null)]), "single-turn"))
      .toBe("judge pass 1 fail 0 unparsed 0 (stated intent only)");
  });

  test("keeps a trial whose judge was unavailable and counts it apart", () => {
    expect(summarizeRecord(record([trial("unavailable", true), trial("pass", false)]), "multi-turn"))
      .toBe("assertions 1/2 (primary) · judge pass 1 fail 0 unparsed 0 unavailable 1");
  });

  test("shows infrastructure failures from this run apart from verdicts", () => {
    expect(summarizeRecord(record([trial("pass", true)]), "multi-turn", 2))
      .toBe("assertions 1/1 (primary) · judge pass 1 fail 0 unparsed 0 · infrastructure failures 2");
  });
});
