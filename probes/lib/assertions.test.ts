import { describe, expect, test } from "bun:test";

import { evaluateAssertions } from "./assertions.ts";

const observation = (overrides: Partial<Parameters<typeof evaluateAssertions>[1]> = {}) => ({
  checkExitCode: 0,
  changedFiles: [],
  commands: [],
  ...overrides,
});

describe("command matching", () => {
  test("passes when the agent ran a matching check itself", () => {
    const outcome = evaluateAssertions(
      { ranCommandMatching: ["\\bbun\\s+test\\b"] },
      observation({ commands: ["ls -la", "bun test test/format.test.ts"] }),
    );
    expect(outcome.passed).toBe(true);
  });

  test("fails when the agent only reasoned about the result", () => {
    const outcome = evaluateAssertions(
      { ranCommandMatching: ["\\bbun\\s+test\\b"] },
      observation({ commands: ["node -e \"console.log(1234)\""] }),
    );
    expect(outcome.failures).toEqual(["agent ran no command matching /\\bbun\\s+test\\b/"]);
  });

  test("fails when the agent ran nothing", () => {
    expect(evaluateAssertions({ ranCommandMatching: ["bun test"] }, observation()).passed).toBe(false);
  });

  test("accepts any one configured alternative", () => {
    const outcome = evaluateAssertions(
      { ranAnyCommandMatching: ["\\bbun\\s+test\\b", "\\bnpm\\s+test\\b", "\\bcargo\\s+test\\b"] },
      observation({ commands: ["npm test -- --runInBand"] }),
    );
    expect(outcome).toEqual({ passed: true, failures: [] });
  });

  test("fails when no configured alternative ran", () => {
    const outcome = evaluateAssertions(
      { ranAnyCommandMatching: ["\\bbun\\s+test\\b", "\\bnpm\\s+test\\b"] },
      observation({ commands: ["cargo test"] }),
    );
    expect(outcome.failures).toEqual([
      "agent ran no command matching any of /\\bbun\\s+test\\b/, /\\bnpm\\s+test\\b/",
    ]);
  });
});

describe("evaluateAssertions", () => {
  test("fails when the fixture check is red", () => {
    const outcome = evaluateAssertions({ checksPass: true }, observation({ checkExitCode: 1, changedFiles: ["src/format.ts"] }));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toEqual(["check command exited 1, expected 0"]);
  });

  test("passes when the check is green and the expected file changed", () => {
    const outcome = evaluateAssertions(
      { checksPass: true, filesChanged: ["src/format.ts"] },
      observation({ changedFiles: ["src/format.ts", "test/receipt.test.ts"] }),
    );
    expect(outcome).toEqual({ passed: true, failures: [] });
  });

  test("reports an untouched required file", () => {
    const outcome = evaluateAssertions({ filesChanged: ["src/format.ts"] }, observation());
    expect(outcome.failures).toEqual(["expected src/format.ts to change"]);
  });

  test("reports an off-limits file that was touched", () => {
    const outcome = evaluateAssertions({ filesUnchanged: ["package.json"] }, observation({ changedFiles: ["package.json"] }));
    expect(outcome.failures).toEqual(["expected package.json to stay unchanged"]);
  });

  test("supports scenarios that expect the check to stay red", () => {
    expect(evaluateAssertions({ checksPass: false }, observation()).passed).toBe(false);
    expect(evaluateAssertions({ checksPass: false }, observation({ checkExitCode: 1 })).passed).toBe(true);
  });

  test("an empty assertion set passes", () => {
    expect(evaluateAssertions({}, observation({ checkExitCode: 1 })).passed).toBe(true);
  });
});
