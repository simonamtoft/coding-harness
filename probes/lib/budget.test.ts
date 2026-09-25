import { describe, expect, test } from "bun:test";

import { addSpend, BENCHMARK_BUDGET, budgetTokens, exhaustedLimit, NO_SPEND, repairPrompt, verifierOutputTail } from "./budget.ts";

const usage = { input: 1000, output: 200, cacheRead: 50_000, cacheWrite: 300, totalTokens: 51_500, cost: 0.05 };

describe("budget accounting", () => {
  test("counts input, output and cache writes but not cache reads", () => {
    expect(budgetTokens(usage)).toBe(1500);
    expect(addSpend(NO_SPEND, usage)).toEqual({ wallTimeMs: 0, tokens: 1500, costUsd: 0.05 });
  });

  test("names the first cap reached, including exactly at the cap", () => {
    expect(exhaustedLimit({ wallTimeMs: 0, tokens: 119_999, costUsd: 2.99 }, BENCHMARK_BUDGET)).toBeNull();
    expect(exhaustedLimit({ wallTimeMs: 0, tokens: 120_000, costUsd: 0 }, BENCHMARK_BUDGET)).toBe("tokens");
    expect(exhaustedLimit({ wallTimeMs: 0, tokens: 0, costUsd: 3 }, BENCHMARK_BUDGET)).toBe("cost");
    expect(exhaustedLimit({ wallTimeMs: 30 * 60_000, tokens: 200_000, costUsd: 9 }, BENCHMARK_BUDGET)).toBe("wall_time");
  });
});

describe("repair feedback", () => {
  test("mirrors verify-turn's attempt wording and marks the final round", () => {
    expect(repairPrompt(1, "bun test", "1 fail")).toStartWith("Verification failed (bun test) — attempt 1/2. Fix it before finishing.");
    expect(repairPrompt(2, "bun test", "1 fail")).toStartWith("Verification failed (bun test) — attempt 2/2 (final).");
    expect(repairPrompt(1, "bun test", "1 fail")).toEndWith("\n\n1 fail");
  });

  test("keeps the tail of long verifier output and says it was truncated", () => {
    const output = Array.from({ length: 2500 }, (_, index) => `line ${index}`).join("\n");
    const tail = verifierOutputTail(output);
    expect(tail).toStartWith("line 500\n");
    expect(tail).toContain("line 2499\n\n[Verifier output truncated: showing the last 2000 of 2500 lines.]");
  });

  test("describes a verifier that failed without output", () => {
    expect(verifierOutputTail("  \n")).toBe("(verifier exited non-zero without output)");
  });
});
