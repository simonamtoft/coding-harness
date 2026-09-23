import type { AssertionOutcome, BashExecution, FixtureAssertions } from "./types.ts";

export type FixtureObservation = {
  /** Exit code of the scenario check command after the probe run; null when it timed out. */
  checkExitCode: number | null;
  /** Fixture-relative paths whose content differs from the pristine fixture, including created paths. */
  changedFiles: string[];
  /** Bash tool calls the agent made, taken from tool events. */
  bashExecutions: BashExecution[];
};

const SEGMENT_SEPARATORS = ["&&", "||", ";", "|", "\n", "&"] as const;
const LEADING_ENV_ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)+/;

/**
 * Splits a shell command into simple-command segments on unquoted list and pipe operators, so a
 * pattern such as `^bun\s+test\b` cannot be satisfied by `echo bun test`. This is lexical: it does
 * not model subshell expansion or whether a later `&&` segment actually executed.
 */
function commandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === "\\" && quote === "\"" && i + 1 < command.length) {
        current += char + command[++i];
        continue;
      }
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "\\" && i + 1 < command.length) {
      current += char + command[++i];
      continue;
    }
    const isRedirection = char === "&" && (command[i - 1] === ">" || command[i - 1] === "<" || command[i + 1] === ">");
    const separator = isRedirection ? undefined : SEGMENT_SEPARATORS.find((candidate) => command.startsWith(candidate, i));
    if (separator) {
      segments.push(current);
      current = "";
      i += separator.length - 1;
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments
    .map((segment) => segment.trim().replace(/^[({!\s]+/, "").replace(LEADING_ENV_ASSIGNMENT, "").trim())
    .filter((segment) => segment !== "");
}

function executedSegments(executions: BashExecution[]): string[] {
  return executions
    .filter((execution) => execution.exitCode !== null)
    .flatMap((execution) => commandSegments(execution.command));
}

export function evaluateAssertions(
  assertions: FixtureAssertions,
  observation: FixtureObservation,
): AssertionOutcome {
  const failures: string[] = [];

  if (assertions.checksPass === true && observation.checkExitCode !== 0) {
    failures.push(observation.checkExitCode === null
      ? "check command timed out, expected exit 0"
      : `check command exited ${observation.checkExitCode}, expected 0`);
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
  if (assertions.allowedChangedFiles) {
    const allowed = new Set(assertions.allowedChangedFiles);
    for (const path of observation.changedFiles) {
      if (!allowed.has(path)) failures.push(`${path} changed but is not an allowed change`);
    }
  }

  const segments = executedSegments(observation.bashExecutions);
  const ran = (pattern: string) => {
    const matcher = new RegExp(pattern);
    return segments.some((segment) => matcher.test(segment));
  };
  for (const pattern of assertions.ranCommandMatching ?? []) {
    if (!ran(pattern)) failures.push(`agent ran no command matching /${pattern}/`);
  }
  const alternatives = assertions.ranAnyCommandMatching ?? [];
  if (alternatives.length > 0 && !alternatives.some(ran)) {
    failures.push(`agent ran no command matching any of ${alternatives.map((pattern) => `/${pattern}/`).join(", ")}`);
  }

  return { passed: failures.length === 0, failures };
}
