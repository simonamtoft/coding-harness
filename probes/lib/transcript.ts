import type { BashExecution } from "./types.ts";

export type RunCompletion = { complete: true } | { complete: false; reason: string };

export type ProbeRun = {
  /** Bash tool calls in start order, with the exit status their end event reported. */
  bashExecutions: BashExecution[];
  finalMessage: string;
  completion: RunCompletion;
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

  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let event: JsonEvent;
    try {
      event = JSON.parse(line) as JsonEvent;
    } catch {
      continue;
    }

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
      finalStopReason = event.message.stopReason;
      finalError = event.message.errorMessage;
      const text = assistantText(event.message);
      if (text) finalMessage = text;
      continue;
    }

    if (event.type === "agent_end") settledAgentEnd = event.willRetry !== true;
  }

  return { bashExecutions, finalMessage, completion: completionOf(settledAgentEnd, finalStopReason, finalError, finalMessage) };
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
