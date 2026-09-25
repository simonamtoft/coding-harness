import { describe, expect, test } from "bun:test";

import { eventUsage, parseProbeRun, ZERO_USAGE } from "./transcript.ts";

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
    expect(parseProbeRun(stdout)).toMatchObject({ bashExecutions: [], finalMessage: "ok", completion: { complete: true } });
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

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0, cost = 0.01) => ({
  input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});
const assistantEnd = (messageUsage: unknown) => ({
  type: "message_end", message: { role: "assistant", stopReason: "toolUse", content: [], usage: messageUsage },
});
const toolStart = (id: string, toolName: string) => ({ type: "tool_execution_start", toolCallId: id, toolName, args: {} });
const toolEnd = (id: string, toolName: string, isError: boolean) => ({
  type: "tool_execution_end", toolCallId: id, toolName, result: { content: [] }, isError,
});

describe("telemetry", () => {
  test("counts calls and failed calls for every tool, and turns", () => {
    const { telemetry } = parseProbeRun(events(
      toolStart("r1", "read"), toolEnd("r1", "read", false),
      toolStart("e1", "edit"), toolEnd("e1", "edit", true),
      toolStart("e2", "edit"), toolEnd("e2", "edit", false),
      bashStart("b1", "bun test"), bashEnd("b1", true, "Command exited with code 1"),
      assistant("still going"),
      assistant("done"),
      agentEnd(),
    ));
    expect(telemetry.tools).toEqual({
      read: { calls: 1, errors: 0 },
      edit: { calls: 2, errors: 1 },
      bash: { calls: 1, errors: 1 },
    });
    expect(telemetry.turns).toBe(2);
  });

  test("sums assistant usage and reports the last prompt size", () => {
    const { telemetry } = parseProbeRun(events(
      assistantEnd(usage(1000, 100, 0, 5000, 0.02)),
      assistantEnd(usage(200, 50, 6000, 100, 0.01)),
      assistant("done"),
      agentEnd(),
    ));
    expect(telemetry.assistantMessages).toBe(2);
    expect(telemetry.messagesWithoutUsage).toBe(0);
    expect(telemetry.usage).toEqual({ input: 1200, output: 150, cacheRead: 6000, cacheWrite: 5100, totalTokens: 12450, cost: 0.03 });
    expect(telemetry.lastPromptTokens).toBe(6300);
  });

  test("records missing usage as null, never as zero", () => {
    const { telemetry } = parseProbeRun(events(
      assistantEnd(usage(1000, 100)),
      assistantEnd(undefined),
      assistant("done"),
      agentEnd(),
    ));
    expect(telemetry.messagesWithoutUsage).toBe(1);
    expect(telemetry.usage).toBeNull();
    expect(telemetry.lastPromptTokens).toBeNull();
  });

  test("treats a usage object with a non-numeric field as missing", () => {
    expect(eventUsage(assistantEnd({ ...usage(1, 1), cost: { total: "free" } }))).toEqual({ source: "assistant", usage: "missing" });
  });

  test("keeps nested tool usage apart from main-model usage", () => {
    const { telemetry } = parseProbeRun(events(
      { type: "message_end", message: { role: "toolResult", toolCallId: "s", content: [], usage: usage(500, 50, 0, 0, 0.005) } },
      { type: "message_end", message: { role: "toolResult", toolCallId: "t", content: [] } },
      assistantEnd(usage(100, 10)),
      assistant("done"),
      agentEnd(),
    ));
    expect(telemetry.nestedToolUsage).toEqual({ input: 500, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 550, cost: 0.005 });
    expect(telemetry.usage?.input).toBe(100);
  });

  test("treats a run without any assistant usage event as unknown usage, not zero", () => {
    const { telemetry } = parseProbeRun(events(assistant("done"), agentEnd()));
    expect(telemetry.assistantMessages).toBe(0);
    expect(telemetry.usage).toBeNull();
    expect(telemetry.nestedToolUsage).toEqual(ZERO_USAGE);
  });

  test("counts subagent usage reported in the tool result details", () => {
    const child = (input: number, cost: number) => ({
      agent: "reviewer",
      usage: { input, output: 10, cacheRead: 100, cacheWrite: 5, cost, contextTokens: 0, turns: 1 },
    });
    const subagentResult = {
      type: "message_end",
      message: { role: "toolResult", toolCallId: "s", content: [], details: { results: [child(300, 0.02), child(200, 0.01)] } },
    };
    expect(eventUsage(subagentResult)).toEqual({
      source: "tool",
      usage: { input: 500, output: 20, cacheRead: 200, cacheWrite: 10, totalTokens: 730, cost: 0.03 },
    });
  });

  test("records compactions by outcome and provider retries", () => {
    const { telemetry } = parseProbeRun(events(
      { type: "compaction_start", reason: "threshold" },
      { type: "compaction_end", reason: "threshold", result: { summary: "s", tokensBefore: 150000 }, aborted: false },
      { type: "compaction_end", reason: "overflow", aborted: true },
      { type: "compaction_end", reason: "manual", aborted: false, errorMessage: "boom" },
      { type: "auto_retry_start", attempt: 1, maxAttempts: 3 },
      assistant("done"),
      agentEnd(),
    ));
    expect(telemetry.compactions).toEqual([
      { reason: "threshold", tokensBefore: 150000, outcome: "succeeded" },
      { reason: "overflow", tokensBefore: null, outcome: "aborted" },
      { reason: "manual", tokensBefore: null, outcome: "failed" },
    ]);
    expect(telemetry.providerRetries).toBe(1);
  });
});
