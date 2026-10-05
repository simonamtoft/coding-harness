import type { BenchmarkRecord, ProbeRecord, ResultRecord } from "./types.ts";

/** Stated by every benchmark run and release until PI-90 containment is adopted. */
export const BOUNDARY_STATEMENT =
  "Uncontained host run: agent children run on the host with inherited credentials and unblocked network egress; " +
  "only package installs are guarded (PACKAGE_INSTALL_GUARD_ENV), and fixtures are trusted, pinned, and pre-provisioned. " +
  "PI-90 containment is designed but not implemented.";

/** The accepted limitation of a public corpus, stated by every benchmark run and release. */
export const CONTAMINATION_STATEMENT =
  "The fixtures and this corpus are public and may be in model training data: same-model harness-variant " +
  "comparisons stay valid, but cross-generation model comparisons can be inflated.";

/**
 * One report cell. Multi-turn scenarios lead with their deterministic fixture assertions, the
 * primary evidence; single-turn scenarios have only a judge ruling on stated intent; benchmark
 * scenarios are scored by their verifier.
 */
export function summarizeRecord(record: ResultRecord, infrastructureFailuresThisRun = 0): string {
  const parts = record.scenarioKind === "benchmark" ? benchmarkParts(record) : probeParts(record);
  if (infrastructureFailuresThisRun > 0) parts.push(`infrastructure failures ${infrastructureFailuresThisRun}`);
  return parts.join(" · ");
}

function probeParts(record: ProbeRecord): string[] {
  const count = (verdict: string) => record.trials.filter((trial) => trial.judge.verdict === verdict).length;
  const unavailable = count("unavailable");
  const skipped = count("skipped");
  const judge = `judge pass ${count("pass")} fail ${count("fail")} unparsed ${count("unparsed")}` +
    (unavailable > 0 ? ` unavailable ${unavailable}` : "") +
    (skipped > 0 ? ` skipped ${skipped} (hard boundary broken)` : "");
  const parts = record.scenarioKind === "multi-turn"
    ? [
      `assertions ${record.trials.filter((trial) => trial.assertions?.passed === true).length}/${record.trials.length} (primary)`,
      ...(record.judgeModel === null ? [] : [judge]),
    ]
    : [`${judge} (stated intent only)`];
  if (record.trials.length === 0) return parts;
  // Agent spend only: judge calls report no usage to the record.
  const bound = record.trials.some((trial) => trial.telemetry.usage === null) ? "≥" : "";
  parts.push(`median agent wall ${(median(record.trials.map((trial) => trial.wallTimeMs)) / 60_000).toFixed(1)}m`);
  parts.push(`median agent cost ${bound}$${median(record.trials.map((trial) => trial.telemetry.usage?.cost ?? 0)).toFixed(2)}`);
  return parts;
}

/**
 * Escapes C0 and C1 control characters other than newline and tab as `\uXXXX`, so agent-controlled
 * text printed for a human reviewer cannot move the cursor, clear the screen, or set the clipboard.
 */
export function terminalSafe(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function benchmarkParts(record: BenchmarkRecord): string[] {
  const { trials } = record;
  const count = (outcome: string) => trials.filter((trial) => trial.outcome === outcome).length;
  const judged = record.judgeModel !== null;
  const unjudged = count("unjudged");
  const parts = [
    `${judged ? "judge" : "verifier"} passed ${count("passed")}/${trials.length} (primary)`,
    `failed ${count("failed")} budget exhausted ${count("budget_exhausted")}${unjudged > 0 ? ` unjudged ${unjudged}` : ""}`,
  ];
  if (trials.length === 0) return parts;
  const judgements = trials.flatMap((trial) => (trial.judgement?.verdict === "judged" ? [trial.judgement] : []));
  if (judgements.length > 0) parts.push(`median recall ${median(judgements.map((judgement) => judgement.recall)).toFixed(2)}`);
  const reviews = judgements.flatMap((judgement) => (judgement.scoring === "review" ? [judgement] : []));
  const precisions = reviews.flatMap((review) => (review.precision === null ? [] : [review.precision]));
  if (precisions.length > 0) parts.push(`median precision ${median(precisions).toFixed(2)}`);
  if (reviews.length > 0) parts.push(`duplicates ${reviews.reduce((sum, review) => sum + review.duplicates, 0)}`);
  const humanVerdicts = trials.flatMap((trial) => (trial.humanReview ? [trial.humanReview.verdict] : []));
  if (humanVerdicts.length > 0) {
    parts.push(`human pass ${humanVerdicts.filter((verdict) => verdict === "pass").length} fail ${humanVerdicts.filter((verdict) => verdict === "fail").length}`);
  }
  // Judged tasks run one round and never repair.
  if (!judged) parts.push(`repair rounds ${trials.map((trial) => trial.repairRounds).join(",")}`);
  const missingHandoffs = trials.filter((trial) => trial.continuation !== null && trial.continuation.handoff === null).length;
  if (missingHandoffs > 0) parts.push(`handoff missing ${missingHandoffs}`);
  // Spend is a lower bound when usage was missing; say so rather than print it as exact.
  const incomplete = trials.some((trial) => trial.rounds.some((round) => round.telemetry.usage === null));
  const bound = incomplete ? "≥" : "";
  parts.push(`median tokens ${bound}${Math.round(median(trials.map((trial) => trial.spent.tokens)))}`);
  parts.push(`median cost ${bound}$${median(trials.map((trial) => trial.spent.costUsd)).toFixed(2)}`);
  return parts;
}
