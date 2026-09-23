import { describe, expect, test } from "bun:test";

import { evaluateAssertions } from "./assertions.ts";

const exited = (...commands: string[]) => commands.map((command) => ({ command, exitCode: 0 }));

const observation = (overrides: Partial<Parameters<typeof evaluateAssertions>[1]> = {}) => ({
  checkExitCode: 0,
  changedFiles: [],
  bashExecutions: [],
  ...overrides,
});

describe("command matching", () => {
  test("passes when the agent ran a matching check itself", () => {
    const outcome = evaluateAssertions(
      { ranCommandMatching: ["\\bbun\\s+test\\b"] },
      observation({ bashExecutions: exited("ls -la", "bun test test/format.test.ts") }),
    );
    expect(outcome.passed).toBe(true);
  });

  test("fails when the agent only reasoned about the result", () => {
    const outcome = evaluateAssertions(
      { ranCommandMatching: ["\\bbun\\s+test\\b"] },
      observation({ bashExecutions: exited("node -e \"console.log(1234)\"") }),
    );
    expect(outcome.failures).toEqual(["agent ran no command matching /\\bbun\\s+test\\b/"]);
  });

  test("fails when the agent ran nothing", () => {
    expect(evaluateAssertions({ ranCommandMatching: ["bun test"] }, observation()).passed).toBe(false);
  });

  test("accepts any one configured alternative", () => {
    const outcome = evaluateAssertions(
      { ranAnyCommandMatching: ["\\bbun\\s+test\\b", "\\bnpm\\s+test\\b", "\\bcargo\\s+test\\b"] },
      observation({ bashExecutions: exited("npm test -- --runInBand") }),
    );
    expect(outcome).toEqual({ passed: true, failures: [] });
  });

  test("fails when no configured alternative ran", () => {
    const outcome = evaluateAssertions(
      { ranAnyCommandMatching: ["\\bbun\\s+test\\b", "\\bnpm\\s+test\\b"] },
      observation({ bashExecutions: exited("cargo test") }),
    );
    expect(outcome.failures).toEqual([
      "agent ran no command matching any of /\\bbun\\s+test\\b/, /\\bnpm\\s+test\\b/",
    ]);
  });

  const focused = { ranCommandMatching: ["^bun\\s+test\\b"] };

  test("rejects a matching string that was only echoed or quoted", () => {
    const outcome = evaluateAssertions(
      focused,
      observation({ bashExecutions: exited("echo bun test", "grep -r 'x && bun test' .", "printf \"%s; bun test\"") }),
    );
    expect(outcome.passed).toBe(false);
  });

  test("accepts the check as one simple command within a list or pipeline", () => {
    for (const command of [
      "cd /tmp/work && bun test test/format.test.ts",
      "bun test test/format.test.ts 2>&1 | tail -20",
      "CI=1 bun test",
      "(bun test)",
    ]) {
      expect(evaluateAssertions(focused, observation({ bashExecutions: exited(command) })).passed).toBe(true);
    }
  });

  test("counts a check that ran and exited non-zero", () => {
    const outcome = evaluateAssertions(focused, observation({ bashExecutions: [{ command: "bun test", exitCode: 1 }] }));
    expect(outcome.passed).toBe(true);
  });

  test("ignores a command that never reached an exit status", () => {
    const outcome = evaluateAssertions(focused, observation({ bashExecutions: [{ command: "bun test", exitCode: null }] }));
    expect(outcome.passed).toBe(false);
  });
});

describe("allowedChangedFiles", () => {
  test("an empty allow-list rejects every change, including created files", () => {
    const outcome = evaluateAssertions({ allowedChangedFiles: [] }, observation({ changedFiles: ["docs/plan.md"] }));
    expect(outcome.failures).toEqual(["docs/plan.md changed but is not an allowed change"]);
  });

  test("accepts changes limited to the allow-list", () => {
    const outcome = evaluateAssertions(
      { allowedChangedFiles: ["src/format.ts", "test/format.test.ts"] },
      observation({ changedFiles: ["src/format.ts"] }),
    );
    expect(outcome.passed).toBe(true);
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

  test("reports a timed-out check", () => {
    expect(evaluateAssertions({ checksPass: true }, observation({ checkExitCode: null })).failures)
      .toEqual(["check command timed out, expected exit 0"]);
  });

  test("an empty assertion set passes", () => {
    expect(evaluateAssertions({}, observation({ checkExitCode: 1 })).passed).toBe(true);
  });
});
