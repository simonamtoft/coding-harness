import { describe, expect, mock, test } from "bun:test";

mock.module("typebox", () => ({
  Type: {
    Array: () => ({}),
    Object: () => ({}),
    Optional: () => ({}),
    String: () => ({}),
  },
}));

const { default: askQuestionExtension } = await import("./index.ts");

describe("ask_question prompt guidance", () => {
  test("requires visible decision context before opening the question UI", () => {
    let beforeAgentStart: ((event: { systemPrompt: string }) => { systemPrompt: string }) | undefined;
    let tool: { promptGuidelines?: string[] } | undefined;

    askQuestionExtension({
      on(event: string, handler: typeof beforeAgentStart) {
        if (event === "before_agent_start") beforeAgentStart = handler;
      },
      registerTool(definition: typeof tool) {
        tool = definition;
      },
    } as never);

    const injectedPrompt = beforeAgentStart?.({ systemPrompt: "base prompt" }).systemPrompt;
    const toolGuidance = tool?.promptGuidelines?.join("\n");

    expect(injectedPrompt).toContain("write a concise context block in the same assistant response");
    expect(injectedPrompt).toContain("If asking approval of a plan, include the plan");
    expect(injectedPrompt).toContain("do not batch it with other tool calls");
    expect(injectedPrompt).not.toContain("That response must contain only the ask_question call");
    expect(toolGuidance).toContain("write a concise visible context block in the same assistant response");
    expect(toolGuidance).toContain("include the plan");
    expect(toolGuidance).toContain("do not batch it with edit, write, bash, or other tool calls");
  });
});
