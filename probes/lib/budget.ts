import type { BudgetLimit, BudgetSpend, UsageTotals } from "./types.ts";

export type BudgetCaps = { wallTimeMs: number; tokens: number; costUsd: number };

/** Per-trial caps for benchmark scenarios, spanning the task and every repair round. */
export const BENCHMARK_BUDGET: BudgetCaps = { wallTimeMs: 30 * 60_000, tokens: 120_000, costUsd: 3 };

/** Verifier failures fed back after the task round, approximating verify-turn's MAX_ROUNDS. */
export const MAX_REPAIR_ROUNDS = 2;

export const NO_SPEND: BudgetSpend = { wallTimeMs: 0, tokens: 0, costUsd: 0 };

/**
 * Tokens counted against the cap. Cache reads are excluded: every turn re-reads the whole context,
 * so counting them would exhaust the cap on almost any multi-turn task. The cost cap prices them.
 */
export function budgetTokens(usage: UsageTotals): number {
  return usage.input + usage.output + usage.cacheWrite;
}

export function addSpend(spend: BudgetSpend, usage: UsageTotals): BudgetSpend {
  return { ...spend, tokens: spend.tokens + budgetTokens(usage), costUsd: spend.costUsd + usage.cost };
}

/** The first cap reached, checked in the order wall time, tokens, cost. */
export function exhaustedLimit(spend: BudgetSpend, caps: BudgetCaps): BudgetLimit | null {
  if (spend.wallTimeMs >= caps.wallTimeMs) return "wall_time";
  if (spend.tokens >= caps.tokens) return "tokens";
  if (spend.costUsd >= caps.costUsd) return "cost";
  return null;
}

const MAX_FEEDBACK_LINES = 2000;
const MAX_FEEDBACK_BYTES = 50 * 1024;

/** Keeps the tail of verifier output within the limits Pi's own verify-turn applies. */
export function verifierOutputTail(output: string): string {
  const trimmed = output.trim() || "(verifier exited non-zero without output)";
  const allLines = trimmed.split("\n");
  const kept = allLines.slice(-MAX_FEEDBACK_LINES);
  const bytes = (lines: string[]) => Buffer.byteLength(lines.join("\n"));
  while (kept.length > 1 && bytes(kept) > MAX_FEEDBACK_BYTES) kept.shift();
  let tail = kept.join("\n");
  if (Buffer.byteLength(tail) > MAX_FEEDBACK_BYTES) tail = Buffer.from(tail).subarray(-MAX_FEEDBACK_BYTES).toString("utf8");
  if (tail === trimmed) return tail;
  return `${tail}\n\n[Verifier output truncated: showing the last ${kept.length} of ${allLines.length} lines.]`;
}

/**
 * Follow-up prompt for a repair round. Mirrors the wording of the verify-turn extension
 * (pi/agent/extensions/verify-turn/index.ts) without importing it, so building the benchmark does
 * not change the canonical harness; keep the two in step.
 */
export function repairPrompt(round: number, verifierLabel: string, output: string): string {
  const reportingReminder =
    "In your next response, carry forward the complete original-task summary and prior verification; add this repair rather than reporting only the latest failure or fix.";
  const instruction = round === MAX_REPAIR_ROUNDS
    ? `Verification failed (${verifierLabel}) — attempt ${round}/${MAX_REPAIR_ROUNDS} (final). Fix the failure if possible. If the next verification still fails, stop and summarize the remaining problem for the user. ${reportingReminder}`
    : `Verification failed (${verifierLabel}) — attempt ${round}/${MAX_REPAIR_ROUNDS}. Fix it before finishing. ${reportingReminder}`;
  return `${instruction}\n\n${verifierOutputTail(output)}`;
}
