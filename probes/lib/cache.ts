import { sha256Hex } from "./hashing.ts";
import type { HarnessMode, ResultRecord } from "./types.ts";

/** Bump when a change to execution or scoring makes older records incomparable. */
export const RUNNER_VERSION = "5";

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
  judgeModel: string;
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
    key.judgeModel,
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

/** Comparable records are topped up rather than discarded when more trials are requested. */
export function missingTrials(record: ResultRecord | null, want: ReuseRequest): number {
  if (!record || !measuresSameSetup(record, want)) return want.trials;
  return Math.max(0, want.trials - record.trials.length);
}
