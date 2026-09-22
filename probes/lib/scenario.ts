import type { Scenario } from "./types.ts";

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

export function parseScenario(raw: unknown, id: string): Scenario {
  if (typeof raw !== "object" || raw === null) {
    throw new ScenarioError(`scenario ${id}: definition must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "single-turn" && kind !== "multi-turn") {
    throw new ScenarioError(`scenario ${id}: kind must be "single-turn" or "multi-turn"`);
  }

  const assertionsRaw = record.assertions;
  if (assertionsRaw !== undefined && (typeof assertionsRaw !== "object" || assertionsRaw === null)) {
    throw new ScenarioError(`scenario ${id}: assertions must be an object`);
  }
  const assertionsRecord = (assertionsRaw ?? {}) as Record<string, unknown>;
  if (assertionsRecord.checksPass !== undefined && typeof assertionsRecord.checksPass !== "boolean") {
    throw new ScenarioError(`scenario ${id}: assertions.checksPass must be a boolean`);
  }

  const scenario: Scenario = {
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

  if (assertionsRaw !== undefined) {
    const filesChanged = optionalStringArray(assertionsRecord.filesChanged, "assertions.filesChanged", id);
    const filesUnchanged = optionalStringArray(assertionsRecord.filesUnchanged, "assertions.filesUnchanged", id);
    scenario.assertions = {};
    if (assertionsRecord.checksPass !== undefined) {
      scenario.assertions.checksPass = assertionsRecord.checksPass as boolean;
    }
    const commandPatternFields = ["ranCommandMatching", "ranAnyCommandMatching"] as const;
    if (filesChanged) scenario.assertions.filesChanged = filesChanged;
    if (filesUnchanged) scenario.assertions.filesUnchanged = filesUnchanged;
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
