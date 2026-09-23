import { describe, expect, test } from "bun:test";

import { isReusable, missingTrials, recordFileName, RUNNER_VERSION } from "./cache.ts";
import type { ResultRecord, TrialRecord } from "./types.ts";

const trial: TrialRecord = {
  trial: 1,
  assertions: { passed: true, failures: [] },
  judge: { verdict: "pass", reason: "ran the focused tests" },
  judgeEvidence: "bun test test/format.test.ts exited 0",
  bashExecutions: [{ command: "bun test test/format.test.ts", exitCode: 0 }],
  finalMessage: "done",
};

const record: ResultRecord = {
  runnerVersion: RUNNER_VERSION,
  harnessMode: "isolated",
  harnessHash: "isolated",
  runtimeHash: null,
  runtime: { piVersion: "0.87.1", bunVersion: "1.4.2" },
  scenarioId: "coupled-test-break",
  scenarioHash: "scenario-hash",
  instructionsHash: "instructions-hash",
  variantLabel: "baseline",
  model: "anthropic/claude-sonnet-5",
  judgeModel: "anthropic/claude-sonnet-5",
  createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
  trials: [trial, { ...trial, trial: 2 }, { ...trial, trial: 3 }],
  infrastructureFailures: [],
};

const want = {
  harnessMode: record.harnessMode,
  harnessHash: record.harnessHash,
  runtimeHash: record.runtimeHash,
  scenarioId: record.scenarioId,
  model: record.model,
  instructionsHash: record.instructionsHash,
  scenarioHash: record.scenarioHash,
  judgeModel: record.judgeModel,
  trials: 3,
};


describe("isReusable", () => {
  test("reuses a matching record", () => {
    expect(isReusable(record, want)).toBe(true);
  });

  test("reuses a record with more trials than requested", () => {
    expect(isReusable(record, { ...want, trials: 2 })).toBe(true);
  });

  test("reruns when fewer trials were recorded", () => {
    expect(isReusable(record, { ...want, trials: 4 })).toBe(false);
  });

  test("reruns when the instructions changed", () => {
    expect(isReusable(record, { ...want, instructionsHash: "other" })).toBe(false);
  });

  test("reruns when the scenario or fixture changed", () => {
    expect(isReusable(record, { ...want, scenarioHash: "other" })).toBe(false);
  });

  test("reruns for a different model or judge", () => {
    expect(isReusable(record, { ...want, model: "openai-codex/gpt-5.6-luna" })).toBe(false);
    expect(isReusable(record, { ...want, judgeModel: "anthropic/claude-opus-5" })).toBe(false);
  });

  test("reruns when the runner version moved on", () => {
    expect(isReusable({ ...record, runnerVersion: "0" }, want)).toBe(false);
  });

  test("reruns for a different harness mode or effective harness", () => {
    expect(isReusable(record, { ...want, harnessMode: "whole" })).toBe(false);
    expect(isReusable(record, { ...want, harnessHash: "changed-harness" })).toBe(false);
  });

  test("reruns when the whole-mode runtime fingerprint changed", () => {
    const whole = { ...record, harnessMode: "whole" as const, runtimeHash: "runtime-a" };
    const wantWhole = { ...want, harnessMode: "whole" as const, runtimeHash: "runtime-a" };
    expect(isReusable(whole, wantWhole)).toBe(true);
    expect(isReusable(whole, { ...wantWhole, runtimeHash: "runtime-b" })).toBe(false);
  });
});

describe("missingTrials", () => {
  test("tops up a comparable record instead of discarding its trials", () => {
    expect(missingTrials(record, { ...want, trials: 5 })).toBe(2);
  });

  test("needs nothing when the record already has enough trials", () => {
    expect(missingTrials(record, { ...want, trials: 2 })).toBe(0);
  });

  test("runs everything when no record exists or the setup differs", () => {
    expect(missingTrials(null, want)).toBe(3);
    expect(missingTrials(record, { ...want, scenarioHash: "other" })).toBe(3);
    expect(missingTrials({ ...record, runnerVersion: "0" }, want)).toBe(3);
  });
});

describe("recordFileName", () => {
  const key = {
    harnessMode: "isolated" as const,
    harnessHash: "isolated",
    runtimeHash: null,
    scenarioId: "focused-check-own-change",
    model: "openai-codex/gpt-5.6-luna",
    instructionsHash: "0123456789abcdef0123",
    scenarioHash: "scenario-hash",
    judgeModel: "anthropic/claude-sonnet-5",
  };

  test("is filesystem-safe and starts with scenario, model and instruction hash", () => {
    expect(recordFileName(key)).toMatch(
      /^focused-check-own-change__openai-codex-gpt-5\.6-luna__0123456789ab__[0-9a-f]{8}\.json$/,
    );
  });

  test("separates records for different instruction variants", () => {
    expect(recordFileName({ ...key, instructionsHash: "aaaaaaaaaaaaaa" }))
      .not.toBe(recordFileName({ ...key, instructionsHash: "bbbbbbbbbbbbbb" }));
  });

  test("separates model ids that normalize to the same filename text", () => {
    expect(recordFileName({ ...key, model: "provider/model_name" }))
      .not.toBe(recordFileName({ ...key, model: "provider/model-name" }));
  });

  test("keeps separate files per judge, scenario, and harness setup", () => {
    expect(recordFileName({ ...key, judgeModel: "anthropic/claude-opus-5" })).not.toBe(recordFileName(key));
    expect(recordFileName({ ...key, scenarioHash: "other" })).not.toBe(recordFileName(key));
    expect(recordFileName({ ...key, harnessMode: "whole" })).not.toBe(recordFileName(key));
    expect(recordFileName({ ...key, harnessHash: "changed-harness" })).not.toBe(recordFileName(key));
    expect(recordFileName({ ...key, runtimeHash: "runtime" })).not.toBe(recordFileName(key));
  });

  test("is stable for an unchanged setup, so a record is found again", () => {
    expect(recordFileName({ ...key })).toBe(recordFileName(key));
  });
});
