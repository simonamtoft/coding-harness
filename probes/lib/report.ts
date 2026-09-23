import type { ResultRecord, ScenarioKind } from "./types.ts";

/**
 * One report cell. Multi-turn scenarios lead with their deterministic fixture assertions, the
 * primary evidence; single-turn scenarios have only a judge ruling on stated intent.
 */
export function summarizeRecord(record: ResultRecord, kind: ScenarioKind, infrastructureFailuresThisRun = 0): string {
  const count = (verdict: string) => record.trials.filter((trial) => trial.judge.verdict === verdict).length;
  const unavailable = count("unavailable");
  const judge = `judge pass ${count("pass")} fail ${count("fail")} unparsed ${count("unparsed")}` +
    (unavailable > 0 ? ` unavailable ${unavailable}` : "");
  const parts = kind === "multi-turn"
    ? [
      `assertions ${record.trials.filter((trial) => trial.assertions?.passed === true).length}/${record.trials.length} (primary)`,
      judge,
    ]
    : [`${judge} (stated intent only)`];
  if (infrastructureFailuresThisRun > 0) parts.push(`infrastructure failures ${infrastructureFailuresThisRun}`);
  return parts.join(" · ");
}
