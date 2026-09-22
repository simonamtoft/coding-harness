import { describe, expect, test } from "bun:test";

import { parseProbeRun } from "./transcript.ts";

const events = (...lines: unknown[]) => lines.map((line) => JSON.stringify(line)).join("\n");

describe("parseProbeRun", () => {
  test("collects executed bash commands in order", () => {
    const stdout = events(
      { type: "tool_execution_start", toolName: "read", args: { path: "src/format.ts" } },
      { type: "tool_execution_start", toolName: "bash", args: { command: "bun test test/format.test.ts" } },
      { type: "tool_execution_start", toolName: "bash", args: { command: "bun test" } },
      { type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
    );
    expect(parseProbeRun(stdout)).toEqual({
      commands: ["bun test test/format.test.ts", "bun test"],
      finalMessage: "done",
    });
  });

  test("keeps the last assistant turn as the final message", () => {
    const stdout = events(
      { type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "first" }] } },
      { type: "turn_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] } },
      { type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "second" }] } },
    );
    expect(parseProbeRun(stdout).finalMessage).toBe("second");
  });

  test("reports no commands when the agent ran none", () => {
    const stdout = events(
      { type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "verified by inspection" }] } },
    );
    expect(parseProbeRun(stdout).commands).toEqual([]);
  });

  test("ignores malformed lines and non-assistant messages", () => {
    const stdout = `not json\n${events(
      { type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "3 pass" }] } },
      { type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
    )}`;
    expect(parseProbeRun(stdout)).toEqual({ commands: [], finalMessage: "ok" });
  });
});
