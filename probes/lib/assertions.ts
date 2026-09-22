import type { AssertionOutcome, FixtureAssertions } from "./types.ts";

export type FixtureObservation = {
  /** Exit code of the scenario check command after the probe run. */
  checkExitCode: number;
  /** Fixture-relative paths whose content differs from the pristine fixture. */
  changedFiles: string[];
  /** Bash commands the agent executed, taken from tool events. */
  commands: string[];
};

export function evaluateAssertions(
  assertions: FixtureAssertions,
  observation: FixtureObservation,
): AssertionOutcome {
  const failures: string[] = [];

  if (assertions.checksPass === true && observation.checkExitCode !== 0) {
    failures.push(`check command exited ${observation.checkExitCode}, expected 0`);
  }
  if (assertions.checksPass === false && observation.checkExitCode === 0) {
    failures.push("check command passed, expected failure");
  }

  const changed = new Set(observation.changedFiles);
  for (const path of assertions.filesChanged ?? []) {
    if (!changed.has(path)) failures.push(`expected ${path} to change`);
  }
  for (const path of assertions.filesUnchanged ?? []) {
    if (changed.has(path)) failures.push(`expected ${path} to stay unchanged`);
  }

  for (const pattern of assertions.ranCommandMatching ?? []) {
    const matcher = new RegExp(pattern);
    if (!observation.commands.some((command) => matcher.test(command))) {
      failures.push(`agent ran no command matching /${pattern}/`);
    }
  }

  const alternatives = assertions.ranAnyCommandMatching ?? [];
  if (
    alternatives.length > 0 &&
    !alternatives.some((pattern) => observation.commands.some((command) => new RegExp(pattern).test(command)))
  ) {
    failures.push(`agent ran no command matching any of ${alternatives.map((pattern) => `/${pattern}/`).join(", ")}`);
  }

  return { passed: failures.length === 0, failures };
}
