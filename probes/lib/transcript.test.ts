import { describe, expect, test } from "bun:test";

import { parseProbeRun } from "./transcript.ts";

const events = (...lines: unknown[]) => lines.map((line) => JSON.stringify(line)).join("\n");
const assistant = (text: string, stopReason = "stop") => ({
  type: "turn_end",
  message: { role: "assistant", stopReason, content: [{ type: "text", text }] },
});
const agentEnd = (willRetry = false) => ({ type: "agent_end", messages: [], willRetry });
const bashStart = (id: string, command: string) => ({
  type: "tool_execution_start", toolCallId: id, toolName: "bash", args: { command },
});
const bashEnd = (id: string, isError: boolean, text: string) => ({
  type: "tool_execution_end", toolCallId: id, toolName: "bash", result: { content: [{ type: "text", text }] }, isError,
});

describe("bash executions", () => {
  test("correlates start and end events and reads the exit status", () => {
    const stdout = events(
      { type: "tool_execution_start", toolCallId: "r", toolName: "read", args: { path: "src/format.ts" } },
      bashStart("a", "bun test test/format.test.ts"),
      bashStart("b", "bun test"),
      bashEnd("b", true, "1 fail\n\nCommand exited with code 1"),
      bashEnd("a", false, "3 pass"),
      assistant("done"),
      agentEnd(),
    );
    expect(parseProbeRun(stdout).bashExecutions).toEqual([
      { command: "bun test test/format.test.ts", exitCode: 0 },
      { command: "bun test", exitCode: 1 },
    ]);
  });

  test("records no exit status for blocked, timed-out, or unfinished commands", () => {
    const stdout = events(
      bashStart("blocked", "rm -rf /"),
      bashEnd("blocked", true, "Sandbox blocked tool call: destructive command"),
      bashStart("slow", "sleep 999"),
      bashEnd("slow", true, "Command timed out after 5 seconds"),
      bashStart("open", "bun test"),
      assistant("done"),
      agentEnd(),
    );
    expect(parseProbeRun(stdout).bashExecutions.map((execution) => execution.exitCode)).toEqual([null, null, null]);
  });

  test("reports no executions when the agent ran none", () => {
    expect(parseProbeRun(events(assistant("verified by inspection"), agentEnd())).bashExecutions).toEqual([]);
  });
});

describe("final message and completion", () => {
  test("keeps the last assistant text as the final message", () => {
    const stdout = events(
      assistant("first"),
      { type: "turn_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "hmm" }] } },
      assistant("second"),
      agentEnd(),
    );
    expect(parseProbeRun(stdout)).toMatchObject({ finalMessage: "second", completion: { complete: true } });
  });

  test("ignores malformed lines and non-assistant messages", () => {
    const stdout = `not json\n${events(
      { type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "3 pass" }] } },
      assistant("ok"),
      agentEnd(),
    )}`;
    expect(parseProbeRun(stdout)).toEqual({ bashExecutions: [], finalMessage: "ok", completion: { complete: true } });
  });

  test("is incomplete when the final request errored, even after earlier text", () => {
    const stdout = events(
      assistant("working on it"),
      { type: "turn_end", message: { role: "assistant", stopReason: "error", errorMessage: "529 overloaded", content: [] } },
      agentEnd(),
    );
    expect(parseProbeRun(stdout).completion).toEqual({
      complete: false,
      reason: "final assistant request ended with error: 529 overloaded",
    });
  });

  test("is incomplete when the stream stops before the agent run ends", () => {
    expect(parseProbeRun(events(assistant("partial"))).completion).toEqual({
      complete: false,
      reason: "no final agent_end event",
    });
  });

  test("waits for the agent_end that will not be retried", () => {
    expect(parseProbeRun(events(assistant("x"), agentEnd(true))).completion.complete).toBe(false);
    expect(parseProbeRun(events(assistant("x"), agentEnd(true), assistant("y"), agentEnd())).completion.complete).toBe(true);
  });

  test("is incomplete without any final assistant text", () => {
    expect(parseProbeRun(events(agentEnd())).completion).toEqual({ complete: false, reason: "no final assistant text" });
  });
});
