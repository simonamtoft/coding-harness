import type { BashExecution, CompactionEvent, RunTelemetry, UsageTotals } from "./types.ts";

export type RunCompletion = { complete: true } | { complete: false; reason: string };

export type ProbeRun = {
  /** Bash tool calls in start order, with the exit status their end event reported. */
  bashExecutions: BashExecution[];
  finalMessage: string;
  completion: RunCompletion;
  telemetry: RunTelemetry;
};

type JsonEvent = Record<string, unknown>;

// Pi's bash tool reports a non-zero exit by failing the call with this trailing status line.
const NON_ZERO_EXIT_STATUS = /Command exited with code (\d+)\s*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assistantText(message: Record<string, unknown>): string | null {
  if (!Array.isArray(message.content)) return null;
  const text = message.content
    .filter((part): part is { type: string; text: string } =>
      isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return text.trim() === "" ? null : text.trim();
}

function resultText(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  return result.content
    .filter((part): part is { type: string; text: string } =>
      isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Parses Pi's `Usage`; null unless every counted field is a finite number. */
function parseUsage(raw: unknown): UsageTotals | null {
  if (!isRecord(raw) || !isRecord(raw.cost)) return null;
  const input = finiteNumber(raw.input);
  const output = finiteNumber(raw.output);
  const cacheRead = finiteNumber(raw.cacheRead);
  const cacheWrite = finiteNumber(raw.cacheWrite);
  const totalTokens = finiteNumber(raw.totalTokens);
  const cost = finiteNumber(raw.cost.total);
  if (input === null || output === null || cacheRead === null || cacheWrite === null || totalTokens === null || cost === null) {
    return null;
  }
  return { input, output, cacheRead, cacheWrite, totalTokens, cost };
}

/**
 * Usage carried by one JSON event, or null for events that carry none. An assistant `message_end`
 * without well-formed usage is `missing`; tool results carry usage only for nested model work.
 */
export type EventUsage =
  | { source: "assistant" | "tool"; usage: UsageTotals }
  | { source: "assistant"; usage: "missing" };

export function eventUsage(event: unknown): EventUsage | null {
  if (!isRecord(event) || event.type !== "message_end" || !isRecord(event.message)) return null;
  const { role, usage, details } = event.message;
  if (role === "assistant") return { source: "assistant", usage: parseUsage(usage) ?? "missing" };
  if (role !== "toolResult") return null;
  const parsed = parseUsage(usage) ?? subagentUsage(details);
  return parsed ? { source: "tool", usage: parsed } : null;
}

/**
 * Usage of this repository's subagent tool, which reports each child run in
 * `details.results[*].usage` (pi/agent/extensions/subagent) rather than in the tool result's
 * `usage`. Its per-child shape has `cost` as a number and no `totalTokens`. Null when absent.
 */
function subagentUsage(details: unknown): UsageTotals | null {
  if (!isRecord(details) || !Array.isArray(details.results)) return null;
  let total: UsageTotals | null = null;
  for (const result of details.results) {
    const usage = isRecord(result) && isRecord(result.usage) ? result.usage : null;
    if (!usage) continue;
    const input = finiteNumber(usage.input);
    const output = finiteNumber(usage.output);
    const cacheRead = finiteNumber(usage.cacheRead);
    const cacheWrite = finiteNumber(usage.cacheWrite);
    const cost = finiteNumber(usage.cost);
    if (input === null || output === null || cacheRead === null || cacheWrite === null || cost === null) continue;
    total = addUsage(total ?? ZERO_USAGE, {
      input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost,
    });
  }
  return total;
}

export const ZERO_USAGE: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: a.cost + b.cost,
  };
}

function compactionOf(event: JsonEvent): CompactionEvent {
  const result = isRecord(event.result) ? event.result : null;
  return {
    reason: typeof event.reason === "string" ? event.reason : null,
    tokensBefore: result ? finiteNumber(result.tokensBefore) : null,
    outcome: result ? "succeeded" : event.aborted === true ? "aborted" : "failed",
  };
}

function bashExitCode(event: JsonEvent): number | null {
  if (event.isError === false) return 0;
  const status = NON_ZERO_EXIT_STATUS.exec(resultText(event.result));
  return status ? Number(status[1]) : null;
}

/**
 * Reads `pi --mode json` output. Command evidence comes from correlated tool executions rather
 * than from the agent's own account, and completion comes from the event stream because Pi's JSON
 * mode exits zero even when the final assistant request failed.
 */
export function parseProbeRun(stdout: string): ProbeRun {
  const bashExecutions: BashExecution[] = [];
  const pendingBash = new Map<string, BashExecution>();
  let finalMessage = "";
  let finalStopReason: unknown;
  let finalError: unknown;
  let settledAgentEnd = false;
  const telemetry: RunTelemetry = {
    turns: 0,
    tools: {},
    assistantMessages: 0,
    messagesWithoutUsage: 0,
    usage: null,
    nestedToolUsage: ZERO_USAGE,
    compactions: [],
    providerRetries: 0,
    lastPromptTokens: null,
  };
  let mainUsage = ZERO_USAGE;
  const toolNames = new Map<string, string>();

  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let event: JsonEvent;
    try {
      event = JSON.parse(line) as JsonEvent;
    } catch {
      continue;
    }

    if (event.type === "tool_execution_start" && typeof event.toolName === "string" && typeof event.toolCallId === "string") {
      (telemetry.tools[event.toolName] ??= { calls: 0, errors: 0 }).calls++;
      toolNames.set(event.toolCallId, event.toolName);
    }
    if (event.type === "tool_execution_end" && typeof event.toolCallId === "string" && event.isError === true) {
      const name = toolNames.get(event.toolCallId);
      if (name) telemetry.tools[name].errors++;
    }

    const usage = eventUsage(event);
    if (usage?.source === "tool") telemetry.nestedToolUsage = addUsage(telemetry.nestedToolUsage, usage.usage);
    if (usage?.source === "assistant") {
      telemetry.assistantMessages++;
      if (usage.usage === "missing") {
        telemetry.messagesWithoutUsage++;
        telemetry.lastPromptTokens = null;
      } else {
        mainUsage = addUsage(mainUsage, usage.usage);
        telemetry.lastPromptTokens = usage.usage.input + usage.usage.cacheRead + usage.usage.cacheWrite;
      }
    }

    if (event.type === "compaction_end") telemetry.compactions.push(compactionOf(event));
    if (event.type === "auto_retry_start") telemetry.providerRetries++;

    if (event.type === "tool_execution_start" && event.toolName === "bash") {
      const command = isRecord(event.args) ? event.args.command : undefined;
      if (typeof command !== "string" || typeof event.toolCallId !== "string") continue;
      const execution: BashExecution = { command, exitCode: null };
      bashExecutions.push(execution);
      pendingBash.set(event.toolCallId, execution);
      continue;
    }

    if (event.type === "tool_execution_end" && typeof event.toolCallId === "string") {
      const execution = pendingBash.get(event.toolCallId);
      if (!execution) continue;
      pendingBash.delete(event.toolCallId);
      execution.exitCode = bashExitCode(event);
      continue;
    }

    if (event.type === "turn_end" && isRecord(event.message) && event.message.role === "assistant") {
      telemetry.turns++;
      finalStopReason = event.message.stopReason;
      finalError = event.message.errorMessage;
      const text = assistantText(event.message);
      if (text) finalMessage = text;
      continue;
    }

    if (event.type === "agent_end") settledAgentEnd = event.willRetry !== true;
  }

  // A run with no assistant usage event at all has unknown usage, not zero.
  telemetry.usage = telemetry.assistantMessages > 0 && telemetry.messagesWithoutUsage === 0 ? mainUsage : null;
  return {
    bashExecutions,
    finalMessage,
    completion: completionOf(settledAgentEnd, finalStopReason, finalError, finalMessage),
    telemetry,
  };
}

function completionOf(settledAgentEnd: boolean, stopReason: unknown, error: unknown, finalMessage: string): RunCompletion {
  if (stopReason === "error" || stopReason === "aborted") {
    const detail = typeof error === "string" && error !== "" ? `: ${error}` : "";
    return { complete: false, reason: `final assistant request ended with ${stopReason}${detail}` };
  }
  if (!settledAgentEnd) return { complete: false, reason: "no final agent_end event" };
  if (finalMessage === "") return { complete: false, reason: "no final assistant text" };
  return { complete: true };
}
