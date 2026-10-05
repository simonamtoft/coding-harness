import type { BenchmarkRecord, ProbeRecord, ResultRecord } from "./types.ts";

export const SIGNIFICANCE_THRESHOLD = 0.05;

function passCounts(record: ResultRecord): { passed: number; total: number } {
  if (record.scenarioKind === "benchmark") {
    const scored = record.trials.filter((trial) => trial.outcome !== "unjudged");
    return { passed: scored.filter((trial) => trial.outcome === "passed").length, total: scored.length };
  }
  const scored = record.trials.filter((trial) => trial.judge.verdict !== "unavailable");
  return {
    passed: scored.filter((trial) =>
      (trial.assertions === null || trial.assertions.passed) &&
      (trial.judge.verdict === "pass" || trial.judge.verdict === "not_needed")
    ).length,
    total: scored.length,
  };
}

/** Two-sided Fisher exact test, summing tables as or less likely than the observed table. */
export function fisherExact(aPassed: number, aTotal: number, bPassed: number, bTotal: number): number {
  const n = aTotal + bTotal;
  const logFactorials = [0];
  for (let i = 1; i <= n; i++) logFactorials.push(logFactorials[i - 1] + Math.log(i));
  const choose = (size: number, count: number) =>
    logFactorials[size] - logFactorials[count] - logFactorials[size - count];
  const successes = aPassed + bPassed;
  const probability = (left: number) => Math.exp(
    choose(aTotal, left) + choose(bTotal, successes - left) - choose(n, successes),
  );
  const observed = probability(aPassed);
  let p = 0;
  for (let left = Math.max(0, successes - bTotal); left <= Math.min(aTotal, successes); left++) {
    const candidate = probability(left);
    if (candidate <= observed + 1e-12) p += candidate;
  }
  return Math.min(1, p);
}

export function compareRecords(before: ResultRecord, after: ResultRecord): string {
  const a = passCounts(before);
  const b = passCounts(after);
  if (a.total === 0 || b.total === 0) return `insufficient scored trials (${a.passed}/${a.total} vs ${b.passed}/${b.total})`;
  const p = fisherExact(a.passed, a.total, b.passed, b.total);
  const delta = b.passed / b.total - a.passed / a.total;
  return `${a.passed}/${a.total} vs ${b.passed}/${b.total} · delta ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(0)}pp · Fisher two-sided p=${p.toFixed(4)}` +
    (p < SIGNIFICANCE_THRESHOLD ? " · FLAG" : "");
}

/** Stated by every benchmark run until PI-90 containment is adopted. */
export const BOUNDARY_STATEMENT =
  "Uncontained host run: agent children run on the host with inherited credentials and unblocked network egress; " +
  "only package installs are guarded (PACKAGE_INSTALL_GUARD_ENV), and fixtures are trusted, pinned, and pre-provisioned. " +
  "PI-90 containment is designed but not implemented.";

/** The accepted limitation of a public corpus, stated by every benchmark run. */
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
