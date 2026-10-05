import { describe, expect, test } from "bun:test";

import { parseScenario } from "./scenario.ts";
import type { ProbeScenario } from "./types.ts";

function parseProbe(raw: unknown, id: string): ProbeScenario {
  const scenario = parseScenario(raw, id);
  if (scenario.kind === "benchmark") throw new Error("expected a probe scenario");
  return scenario;
}

const multiTurn = {
  kind: "multi-turn",
  prompt: "change formatting",
  judge: "suite ends green",
  checkCommand: ["bun", "test"],
  assertions: { checksPass: true, filesChanged: ["src/format.ts"] },
};

describe("verifier-aware fields", () => {
  test("keeps the report command and verifier notice", () => {
    const scenario = parseProbe(
      { ...multiTurn, reportCommand: ["bun", "test"], verifierNotice: "task verify" },
      "focused-check-own-change",
    );
    expect(scenario.reportCommand).toEqual(["bun", "test"]);
    expect(scenario.verifierNotice).toBe("task verify");
  });

  test("rejects an invalid command regex", () => {
    expect(() => parseScenario({ ...multiTurn, assertions: { ranCommandMatching: ["bun test("] } }, "x"))
      .toThrow(/invalid regex/);
  });

  test("keeps valid command patterns", () => {
    const scenario = parseProbe(
      {
        ...multiTurn,
        assertions: {
          checksPass: true,
          ranCommandMatching: ["\\bbun\\s+test\\b"],
          ranAnyCommandMatching: ["\\bnpm\\s+test\\b", "\\bcargo\\s+test\\b"],
        },
      },
      "x",
    );
    expect(scenario.assertions?.ranCommandMatching).toEqual(["\\bbun\\s+test\\b"]);
    expect(scenario.assertions?.ranAnyCommandMatching).toEqual(["\\bnpm\\s+test\\b", "\\bcargo\\s+test\\b"]);
  });
});

describe("parseScenario", () => {
  test("parses a multi-turn definition and attaches the directory id", () => {
    expect(parseScenario(multiTurn, "coupled-test-break")).toEqual({
      id: "coupled-test-break",
      kind: "multi-turn",
      prompt: "change formatting",
      judge: "suite ends green",
      checkCommand: ["bun", "test"],
      assertions: { checksPass: true, filesChanged: ["src/format.ts"] },
    });
  });

  test("allows assertion-only multi-turn probes and validates forbidden commands", () => {
    const scenario = parseProbe({ ...multiTurn, judge: undefined, assertions: {
      checksPass: true, forbiddenCommandMatching: ["^\\./scripts/smoke\\.sh\\b"],
    } }, "stop-destructive");
    expect(scenario.judge).toBeUndefined();
    expect(scenario.assertions?.forbiddenCommandMatching).toHaveLength(1);
    expect(() => parseProbe({ ...multiTurn, assertions: { checksPass: true, forbiddenCommandMatching: ["("] } }, "x"))
      .toThrow(/invalid regex/);
  });

  test("parses a single-turn definition", () => {
    const scenario = parseProbe({ kind: "single-turn", prompt: "p", judge: "j" }, "stop-destructive");
    expect(scenario.checkCommand).toBeUndefined();
    expect(scenario.assertions).toBeUndefined();
  });

  test("rejects a multi-turn scenario without a check command", () => {
    expect(() => parseScenario({ ...multiTurn, checkCommand: undefined }, "x")).toThrow(/checkCommand/);
  });

  test("rejects empty check and report commands before a trial starts", () => {
    expect(() => parseScenario({ ...multiTurn, checkCommand: [] }, "x")).toThrow(/checkCommand/);
    expect(() => parseScenario({ ...multiTurn, reportCommand: ["  "] }, "x")).toThrow(/reportCommand/);
  });

  test("requires multi-turn scenarios to declare the expected check result", () => {
    expect(() => parseScenario({ ...multiTurn, assertions: { filesChanged: ["src/format.ts"] } }, "x"))
      .toThrow(/assertions.checksPass/);
    expect(() => parseScenario({ ...multiTurn, assertions: undefined }, "x"))
      .toThrow(/assertions.checksPass/);
  });

  test("rejects fixture expectations on a single-turn scenario", () => {
    expect(() => parseScenario({ kind: "single-turn", prompt: "p", judge: "j", assertions: {} }, "x"))
      .toThrow(/no fixture/);
  });

  test("rejects unknown kinds and missing fields", () => {
    expect(() => parseScenario({ ...multiTurn, kind: "batch" }, "x")).toThrow(/kind/);
    expect(() => parseScenario({ ...multiTurn, judge: "" }, "x")).toThrow(/judge/);
    expect(() => parseScenario({ kind: "single-turn", prompt: "p" }, "x")).toThrow(/need a judge/);
  });

  test("keeps an empty allowed-change list, which forbids every change", () => {
    const scenario = parseProbe({ ...multiTurn, assertions: { checksPass: true, allowedChangedFiles: [] } }, "x");
    expect(scenario.assertions?.allowedChangedFiles).toEqual([]);
  });

  test("rejects malformed assertion fields", () => {
    expect(() => parseScenario({ ...multiTurn, assertions: { filesChanged: "src/format.ts" } }, "x"))
      .toThrow(/filesChanged/);
    expect(() => parseScenario({ ...multiTurn, assertions: { checksPass: true, allowedChangedFiles: "a" } }, "x"))
      .toThrow(/allowedChangedFiles/);
    expect(() => parseScenario({ ...multiTurn, assertions: { checksPass: "yes" } }, "x")).toThrow(/checksPass/);
  });
});

describe("benchmark scenarios", () => {
  const benchmark = { kind: "benchmark", prompt: "fix the parser", verifyCommand: ["bun", "test"] };

  test("parses the prompt and verifier command", () => {
    expect(parseScenario(benchmark, "parser-fix")).toEqual({
      id: "parser-fix",
      kind: "benchmark",
      prompt: "fix the parser",
      scoring: "verifier",
      verifyCommand: ["bun", "test"],
    });
  });

  test("keeps a continuation prompt and rejects other continuation fields", () => {
    expect(parseScenario({ ...benchmark, continuation: { prompt: "finish it" } }, "x"))
      .toMatchObject({ continuation: { prompt: "finish it" } });
    expect(() => parseScenario({ ...benchmark, continuation: { prompt: "" } }, "x")).toThrow(/continuation.prompt/);
    expect(() => parseScenario({ ...benchmark, continuation: { prompt: "p", mode: "fresh" } }, "x")).toThrow(/only a prompt/);
  });

  test("marks a guard on probes and benchmarks and rejects any value but true", () => {
    expect(parseScenario({ ...benchmark, guard: true }, "x")).toMatchObject({ guard: true });
    expect(parseProbe({ ...multiTurn, guard: true }, "x").guard).toBe(true);
    expect(parseProbe(multiTurn, "x").guard).toBeUndefined();
    expect(() => parseScenario({ ...benchmark, guard: false }, "x")).toThrow(/guard must be true/);
    expect(() => parseProbe({ ...multiTurn, guard: "yes" }, "x")).toThrow(/guard must be true/);
  });

  test("keeps the name of a pinned fixture", () => {
    expect(parseScenario({ ...benchmark, fixture: "demo" }, "x")).toMatchObject({ fixture: "demo" });
    expect(() => parseScenario({ ...benchmark, fixture: "" }, "x")).toThrow(/fixture/);
  });

  test("judged scorings take no verifier, and continuation needs one", () => {
    expect(parseScenario({ kind: "benchmark", prompt: "p", scoring: "facts" }, "x")).toEqual({ id: "x", kind: "benchmark", prompt: "p", scoring: "facts" });
    expect(() => parseScenario({ ...benchmark, scoring: "review" }, "x")).toThrow(/take no verifyCommand/);
    expect(() => parseScenario({ kind: "benchmark", prompt: "p", scoring: "facts", continuation: { prompt: "q" } }, "x")).toThrow(/verifier-scored/);
    expect(() => parseScenario({ ...benchmark, scoring: "vibes" }, "x")).toThrow(/scoring must be/);
  });

  test("accepts a positive human review sample only", () => {
    expect(parseScenario({ ...benchmark, humanReviewTrials: 2 }, "x")).toMatchObject({ humanReviewTrials: 2 });
    expect(() => parseScenario({ ...benchmark, humanReviewTrials: 0 }, "x")).toThrow(/humanReviewTrials/);
  });

  test("requires a verifier command", () => {
    expect(() => parseScenario({ ...benchmark, verifyCommand: undefined }, "x")).toThrow(/verifyCommand/);
    expect(() => parseScenario({ ...benchmark, verifyCommand: [] }, "x")).toThrow(/verifyCommand/);
  });

  test("rejects probe-only fields instead of ignoring them", () => {
    expect(() => parseScenario({ ...benchmark, judge: "j" }, "x")).toThrow(/do not support judge/);
    expect(() => parseScenario({ ...benchmark, assertions: {} }, "x")).toThrow(/do not support assertions/);
  });
});
