import { describe, expect, test } from "bun:test";

import { parseScenario } from "./scenario.ts";

const multiTurn = {
  kind: "multi-turn",
  prompt: "change formatting",
  judge: "suite ends green",
  checkCommand: ["bun", "test"],
  assertions: { checksPass: true, filesChanged: ["src/format.ts"] },
};

describe("verifier-aware fields", () => {
  test("keeps the report command and verifier notice", () => {
    const scenario = parseScenario(
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
    const scenario = parseScenario(
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

  test("parses a single-turn definition", () => {
    const scenario = parseScenario({ kind: "single-turn", prompt: "p", judge: "j" }, "stop-destructive");
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
  });

  test("keeps an empty allowed-change list, which forbids every change", () => {
    const scenario = parseScenario({ ...multiTurn, assertions: { checksPass: true, allowedChangedFiles: [] } }, "x");
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
