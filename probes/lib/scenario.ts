import type { BenchmarkScenario, BenchmarkScoring, ProbeScenario, Scenario } from "./types.ts";

class ScenarioError extends Error {}

function requireString(value: unknown, field: string, id: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ScenarioError(`scenario ${id}: ${field} must be a non-empty string`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string, id: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ScenarioError(`scenario ${id}: ${field} must be an array of strings`);
  }
  return value as string[];
}

function optionalCommand(value: unknown, field: string, id: string): string[] | undefined {
  const command = optionalStringArray(value, field, id);
  if (command && (command.length === 0 || command.some((entry) => entry.trim() === ""))) {
    throw new ScenarioError(`scenario ${id}: ${field} must contain a command and non-empty arguments`);
  }
  return command;
}

function isGuard(value: unknown, id: string): boolean {
  if (value !== undefined && value !== true) throw new ScenarioError(`scenario ${id}: guard must be true when present`);
  return value === true;
}

export function parseScenario(raw: unknown, id: string): Scenario {
  if (typeof raw !== "object" || raw === null) {
    throw new ScenarioError(`scenario ${id}: definition must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (kind === "benchmark") return parseBenchmark(record, id);
  if (kind !== "single-turn" && kind !== "multi-turn") {
    throw new ScenarioError(`scenario ${id}: kind must be "single-turn", "multi-turn", or "benchmark"`);
  }

  const assertionsRaw = record.assertions;
  if (assertionsRaw !== undefined && (typeof assertionsRaw !== "object" || assertionsRaw === null)) {
    throw new ScenarioError(`scenario ${id}: assertions must be an object`);
  }
  const assertionsRecord = (assertionsRaw ?? {}) as Record<string, unknown>;
  if (assertionsRecord.checksPass !== undefined && typeof assertionsRecord.checksPass !== "boolean") {
    throw new ScenarioError(`scenario ${id}: assertions.checksPass must be a boolean`);
  }

  const scenario: ProbeScenario = {
    id,
    kind,
    prompt: requireString(record.prompt, "prompt", id),
    judge: requireString(record.judge, "judge", id),
  };

  const checkCommand = optionalCommand(record.checkCommand, "checkCommand", id);
  if (checkCommand) scenario.checkCommand = checkCommand;
  const reportCommand = optionalCommand(record.reportCommand, "reportCommand", id);
  if (reportCommand) scenario.reportCommand = reportCommand;
  if (record.verifierNotice !== undefined) {
    scenario.verifierNotice = requireString(record.verifierNotice, "verifierNotice", id);
  }
  if (isGuard(record.guard, id)) scenario.guard = true;

  if (assertionsRaw !== undefined) {
    const filesChanged = optionalStringArray(assertionsRecord.filesChanged, "assertions.filesChanged", id);
    const filesUnchanged = optionalStringArray(assertionsRecord.filesUnchanged, "assertions.filesUnchanged", id);
    const allowedChangedFiles = optionalStringArray(
      assertionsRecord.allowedChangedFiles,
      "assertions.allowedChangedFiles",
      id,
    );
    scenario.assertions = {};
    if (assertionsRecord.checksPass !== undefined) {
      scenario.assertions.checksPass = assertionsRecord.checksPass as boolean;
    }
    const commandPatternFields = ["ranCommandMatching", "ranAnyCommandMatching"] as const;
    if (filesChanged) scenario.assertions.filesChanged = filesChanged;
    if (filesUnchanged) scenario.assertions.filesUnchanged = filesUnchanged;
    if (allowedChangedFiles) scenario.assertions.allowedChangedFiles = allowedChangedFiles;
    for (const field of commandPatternFields) {
      const patterns = optionalStringArray(assertionsRecord[field], `assertions.${field}`, id);
      if (!patterns) continue;
      for (const pattern of patterns) {
        try {
          new RegExp(pattern);
        } catch {
          throw new ScenarioError(`scenario ${id}: assertions.${field} has invalid regex ${pattern}`);
        }
      }
      scenario.assertions[field] = patterns;
    }
  }

  if (scenario.kind === "multi-turn" && !scenario.checkCommand) {
    throw new ScenarioError(`scenario ${id}: multi-turn scenarios need a checkCommand`);
  }
  if (scenario.kind === "multi-turn" && scenario.assertions?.checksPass === undefined) {
    throw new ScenarioError(`scenario ${id}: multi-turn scenarios must declare assertions.checksPass`);
  }
  if (scenario.kind === "single-turn" && (scenario.checkCommand || scenario.reportCommand || scenario.assertions)) {
    throw new ScenarioError(`scenario ${id}: single-turn scenarios have no fixture to check`);
  }

  return scenario;
}

const BENCHMARK_FIELDS = new Set(["kind", "prompt", "scoring", "verifyCommand", "fixture", "continuation", "humanReviewTrials", "guard"]);
function isScoring(value: unknown): value is BenchmarkScoring {
  return value === "verifier" || value === "facts" || value === "review";
}

function parseBenchmark(record: Record<string, unknown>, id: string): BenchmarkScenario {
  // Probe-only fields would be silently ignored, so reject them instead.
  const unsupported = Object.keys(record).filter((field) => !BENCHMARK_FIELDS.has(field));
  if (unsupported.length > 0) {
    throw new ScenarioError(`scenario ${id}: benchmark scenarios do not support ${unsupported.join(", ")}`);
  }
  const scoring = record.scoring ?? "verifier";
  if (!isScoring(scoring)) {
    throw new ScenarioError(`scenario ${id}: scoring must be "verifier", "facts", or "review"`);
  }
  const verifyCommand = optionalCommand(record.verifyCommand, "verifyCommand", id);
  if (scoring === "verifier" && !verifyCommand) throw new ScenarioError(`scenario ${id}: verifier-scored benchmarks need a verifyCommand`);
  if (scoring !== "verifier" && verifyCommand) throw new ScenarioError(`scenario ${id}: ${scoring}-scored benchmarks are judged and take no verifyCommand`);
  const scenario: BenchmarkScenario = {
    id,
    kind: "benchmark",
    prompt: requireString(record.prompt, "prompt", id),
    scoring,
  };
  if (verifyCommand) scenario.verifyCommand = verifyCommand;
  const reviewTrials = record.humanReviewTrials;
  if (reviewTrials !== undefined) {
    if (typeof reviewTrials !== "number" || !Number.isInteger(reviewTrials) || reviewTrials < 1) {
      throw new ScenarioError(`scenario ${id}: humanReviewTrials must be a positive integer`);
    }
    scenario.humanReviewTrials = reviewTrials;
  }
  if (record.fixture !== undefined) scenario.fixture = requireString(record.fixture, "fixture", id);
  if (isGuard(record.guard, id)) scenario.guard = true;
  if (record.continuation !== undefined) {
    if (scoring !== "verifier") throw new ScenarioError(`scenario ${id}: continuation tasks must be verifier-scored`);
    const continuation = record.continuation;
    if (typeof continuation !== "object" || continuation === null || Object.keys(continuation).some((key) => key !== "prompt")) {
      throw new ScenarioError(`scenario ${id}: continuation must be an object with only a prompt`);
    }
    scenario.continuation = { prompt: requireString((continuation as { prompt?: unknown }).prompt, "continuation.prompt", id) };
  }
  return scenario;
}
