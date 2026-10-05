import { sha256Hex } from "./hashing.ts";
import type { BenchmarkTrialRecord, HarnessMode, ResultRecord, TrialRecord } from "./types.ts";

/** Bump when a change to execution or scoring makes older records incomparable. */
export const RUNNER_VERSION = "7";

/**
 * Shape of a stored record. Bump when fields change, so older documents are kept as evidence but
 * never read as the current shape.
 */
export const RECORD_SCHEMA_VERSION = 1;

const HASH_PREFIX_LENGTH = 12;

export type RecordKey = {
  harnessMode: HarnessMode;
  harnessHash: string;
  /** Whole-mode local runtime fingerprint; null in isolated mode, where it is diagnostic only. */
  runtimeHash: string | null;
  scenarioId: string;
  model: string;
  instructionsHash: string;
  scenarioHash: string;
  /** Null for scenario kinds that are not judged, so changing the judge does not invalidate them. */
  judgeModel: string | null;
};

const SETUP_PREFIX_LENGTH = 8;

/**
 * One file per comparable setup. Every dimension `measuresSameSetup` checks contributes either
 * directly or through the setup hash, so changing harness mode/content, runtime, judge, scenario, or runner
 * keeps the older record available for reuse when you switch back.
 */
export function recordFileName(key: RecordKey): string {
  const model = key.model.replace(/[^a-zA-Z0-9.-]+/g, "-");
  const setup = sha256Hex([
    RUNNER_VERSION,
    key.harnessMode,
    key.harnessHash,
    key.runtimeHash ?? "",
    key.scenarioHash,
    key.model,
    key.judgeModel ?? "",
  ].join("\u0000"))
    .slice(0, SETUP_PREFIX_LENGTH);
  return `${key.scenarioId}__${model}__${key.instructionsHash.slice(0, HASH_PREFIX_LENGTH)}__${setup}.json`;
}

export type ReuseRequest = RecordKey & { trials: number };

/**
 * Whether a record measured the same thing: same runner, harness mode/content, runtime, instructions,
 * scenario definition, fixture, model and judge. Trial count is not part of comparability.
 */
export function measuresSameSetup(record: ResultRecord, want: RecordKey): boolean {
  return (
    record.schemaVersion === RECORD_SCHEMA_VERSION &&
    record.runnerVersion === RUNNER_VERSION &&
    record.harnessMode === want.harnessMode &&
    record.harnessHash === want.harnessHash &&
    record.runtimeHash === want.runtimeHash &&
    record.scenarioId === want.scenarioId &&
    record.scenarioHash === want.scenarioHash &&
    record.instructionsHash === want.instructionsHash &&
    record.model === want.model &&
    record.judgeModel === want.judgeModel
  );
}

/** A comparable record with enough trials needs no model calls at all. */
export function isReusable(record: ResultRecord, want: ReuseRequest): boolean {
  return measuresSameSetup(record, want) && record.trials.length >= want.trials;
}

function failed(trial: TrialRecord | BenchmarkTrialRecord): boolean {
  if ("outcome" in trial) return trial.outcome === "failed" || trial.outcome === "budget_exhausted";
  return trial.assertions?.passed === false || ["fail", "unparsed", "skipped"].includes(trial.judge.verdict);
}

/**
 * Trials a cell should hold. A guard cell holds one until a stored trial fails, then the full
 * `requested` count, so a regression is told apart from a flake. Trials still awaiting a judge
 * verdict do not count as failures.
 */
export function trialTarget(record: ResultRecord | null, requested: number, guard: boolean): number {
  if (!guard) return requested;
  const trials: (TrialRecord | BenchmarkTrialRecord)[] = record?.trials ?? [];
  return trials.some(failed) ? requested : Math.min(1, requested);
}

/** Comparable records are topped up rather than discarded when more trials are requested. */
export function missingTrials(record: ResultRecord | null, want: ReuseRequest): number {
  if (!record || !measuresSameSetup(record, want)) return want.trials;
  return Math.max(0, want.trials - record.trials.length);
}
