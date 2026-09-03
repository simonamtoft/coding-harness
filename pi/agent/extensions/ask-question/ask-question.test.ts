import { describe, expect, mock, test } from "bun:test";

mock.module("typebox", () => ({
  Type: {
    Array: () => ({}),
    Boolean: () => ({}),
    Object: () => ({}),
    Optional: () => ({}),
    String: () => ({}),
  },
}));

// Imports tool.ts, not index.ts: the extension entry point pulls in the TUI
// renderers, which only resolve inside a running pi process.
const { askQuestionTool, CLARIFICATION_GATE } = await import("./tool.ts");
const { buildSelectItems, CUSTOM_ANSWER_VALUE } = await import("./question-items.ts");
const { isUiBusy } = await import("../shared/ui-lock.ts");

type AskQuestionTool = {
  promptGuidelines?: string[];
  prepareArguments?: (args: unknown) => unknown;
  execute: (
    toolCallId: string,
    params: {
      questions: Array<{
        question: string;
        details?: string;
        options?: Array<{ label: string; description?: string }>;
      }>;
    },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{ content: Array<{ text: string }>; details: { status: string; answers: unknown[] } }>;
};

function registerTool(): AskQuestionTool {
  return askQuestionTool as unknown as AskQuestionTool;
}

const ONE_QUESTION = {
  questions: [{ question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] }],
};

const RPC_CONTEXT = { mode: "rpc", hasUI: true };

describe("ask_question prompt guidance", () => {
  test("routes decision context into the question details field, and plans into the message", () => {
    const injectedPrompt = CLARIFICATION_GATE;
    const toolGuidance = askQuestionTool.promptGuidelines.join("\n");

    expect(injectedPrompt).toContain("Put the deciding context in each question's details field");
    expect(injectedPrompt).toContain("put the plan itself in the assistant response");
    expect(injectedPrompt).toContain("do not batch it with other tool calls");
    expect(injectedPrompt).not.toContain("write a concise context block in the same assistant response");
    expect(toolGuidance).toContain("details field stating the decision needed");
    expect(toolGuidance).toContain("Do not repeat ask_question details in prose");
    expect(toolGuidance).toContain("do not batch it with edit, write, bash, or other tool calls");
  });
});

describe("ask_question outcomes", () => {
  test("reports an aborted turn without opening the UI", async () => {
    const select = mock(() => Promise.resolve(undefined));
    const result = await registerTool().execute(
      "call-1",
      ONE_QUESTION,
      AbortSignal.abort(),
      undefined,
      { ...RPC_CONTEXT, ui: { select } },
    );

    expect(result.details.status).toBe("cancelled");
    expect(select).not.toHaveBeenCalled();
  });

  test("distinguishes a missing UI from a user cancellation", async () => {
    const tool = registerTool();

    const unavailable = await tool.execute("call-2", ONE_QUESTION, undefined, undefined, {
      mode: "print",
      hasUI: false,
      ui: {},
    });
    const cancelled = await tool.execute("call-3", ONE_QUESTION, undefined, undefined, {
      ...RPC_CONTEXT,
      ui: { select: () => Promise.resolve(undefined) },
    });

    expect(unavailable.details.status).toBe("unavailable");
    expect(cancelled.details.status).toBe("cancelled");
  });

  test("reports answered questions", async () => {
    const result = await registerTool().execute("call-4", ONE_QUESTION, undefined, undefined, {
      ...RPC_CONTEXT,
      ui: { select: (_title: string, options: string[]) => Promise.resolve(options[0]) },
    });

    expect(result.details.status).toBe("answered");
    expect(result.details.answers).toEqual([{ question: "Ship it?", answer: "Yes", wasCustom: false }]);
  });

  test("asks free-text questions in the multi-line editor", async () => {
    const input = mock(() => Promise.resolve("unused"));
    const result = await registerTool().execute(
      "call-5",
      { questions: [{ question: "Name it?" }] },
      undefined,
      undefined,
      { ...RPC_CONTEXT, ui: { input, editor: () => Promise.resolve("  a name  ") } },
    );

    expect(result.details.answers).toEqual([{ question: "Name it?", answer: "a name", wasCustom: true }]);
    expect(input).not.toHaveBeenCalled();
  });

  test("keeps question details in the transcript after the panel closes", async () => {
    const result = await registerTool().execute(
      "call-6",
      {
        questions: [
          {
            question: "Ship it?",
            details: "The release branch is already tagged.",
            options: [{ label: "Yes" }, { label: "No" }],
          },
        ],
      },
      undefined,
      undefined,
      { ...RPC_CONTEXT, ui: { select: (_title: string, options: string[]) => Promise.resolve(options[0]) } },
    );

    expect(result.content[0].text).toBe("1. Ship it?\nThe release branch is already tagged.\nAnswer: Yes");
  });

  test("claims the shared UI lock while questions are open", async () => {
    let busyDuringPrompt = false;
    const result = registerTool().execute("call-7", ONE_QUESTION, undefined, undefined, {
      ...RPC_CONTEXT,
      ui: {
        select: async (_title: string, options: string[]) => {
          busyDuringPrompt = isUiBusy();
          return options[0];
        },
      },
    });

    await result;
    expect(busyDuringPrompt).toBe(true);
    expect(isUiBusy()).toBe(false);
  });

  test("does not open a queued prompt after its turn is aborted", async () => {
    let releaseFirst!: () => void;
    const first = registerTool().execute("call-queued-1", ONE_QUESTION, undefined, undefined, {
      ...RPC_CONTEXT,
      ui: { select: () => new Promise<string>((resolve) => { releaseFirst = () => resolve("1. Yes"); }) },
    });
    await Promise.resolve();

    const controller = new AbortController();
    const select = mock(() => Promise.resolve("1. Yes"));
    const second = registerTool().execute("call-queued-2", ONE_QUESTION, controller.signal, undefined, {
      ...RPC_CONTEXT,
      ui: { select },
    });
    controller.abort();
    releaseFirst();

    expect((await second).details.status).toBe("cancelled");
    expect(select).not.toHaveBeenCalled();
    await first;
  });

  test("returns an ordered multi-select answer with a custom value", async () => {
    const choices = ["[ ] 1. Unit", "Write a different answer…", "Done selecting"];
    let call = 0;
    const result = await registerTool().execute(
      "call-multiple",
      { questions: [{ question: "Checks?", multiple: true, options: [{ label: "Unit" }, { label: "Integration" }] }] },
      undefined,
      undefined,
      { ...RPC_CONTEXT, ui: { select: () => Promise.resolve(choices[call++]), editor: () => Promise.resolve("Manual") } },
    );

    expect(result.details.answers).toEqual([{ question: "Checks?", answer: ["Unit", "Manual"], wasCustom: true }]);
  });

  test("removes a multi-select custom answer when it is resubmitted empty", async () => {
    const choices = ["[ ] 1. Unit", "Write a different answer…", "Write a different answer…", "Done selecting"];
    const editorValues = ["Manual", ""];
    let choiceIndex = 0;
    let editorIndex = 0;
    const result = await registerTool().execute(
      "call-remove-custom",
      { questions: [{ question: "Checks?", multiple: true, options: [{ label: "Unit" }] }] },
      undefined,
      undefined,
      {
        ...RPC_CONTEXT,
        ui: {
          select: () => Promise.resolve(choices[choiceIndex++]),
          editor: (_title: string, prefill?: string) => {
            if (editorIndex === 1) expect(prefill).toBe("Manual");
            return Promise.resolve(editorValues[editorIndex++]);
          },
        },
      },
    );

    expect(result.details.answers).toEqual([{ question: "Checks?", answer: ["Unit"], wasCustom: false }]);
    expect(result.details.status).toBe("answered");
  });

  test("stages multi-question answers until explicit confirmation and permits going back", async () => {
    const selections = ["1. First", "Back to previous question", "2. Revised", "1. Final", "Confirm answers"];
    let call = 0;
    const result = await registerTool().execute(
      "call-navigation",
      {
        questions: [
          { question: "First?", options: [{ label: "First" }, { label: "Revised" }] },
          { question: "Second?", options: [{ label: "Final" }] },
        ],
      },
      undefined,
      undefined,
      { ...RPC_CONTEXT, ui: { select: () => Promise.resolve(selections[call++]) } },
    );

    expect(result.details.answers).toEqual([
      { question: "First?", answer: "Revised", wasCustom: false },
      { question: "Second?", answer: "Final", wasCustom: false },
    ]);
  });

  test("accepts plain string options and drops the retired recommended field", () => {
    const prepared = registerTool().prepareArguments?.({
      questions: [{ question: "Ship it?", options: ["Yes", "No"], recommended: "Yes" }],
    });

    expect(prepared).toEqual({
      questions: [{ question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] }],
    });
  });
});

describe("question panel items", () => {
  test("numbers options in the given order and keeps descriptions separate", () => {
    const items = buildSelectItems([
      { label: "Port it", description: "More code to maintain" },
      { label: "Inline", description: "No new UI code" },
    ]);

    expect(items).toEqual([
      { value: "0", label: "1. Port it", description: "More code to maintain" },
      { value: "1", label: "2. Inline", description: "No new UI code" },
      { value: CUSTOM_ANSWER_VALUE, label: "3. Write a different answer…" },
    ]);
  });
});
