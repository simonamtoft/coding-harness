import { describe, expect, mock, test } from "bun:test";

mock.module("typebox", () => ({
  Type: {
    Array: (items: unknown, options: object = {}) => ({ items, ...options }),
    Boolean: (options: object = {}) => options,
    Object: (properties: object) => properties,
    Optional: (schema: unknown) => schema,
    String: (options: object = {}) => options,
  },
}));

// Imports tool.ts, not index.ts: the extension entry point pulls in the TUI
// renderers, which only resolve inside a running pi process.
const { askQuestionTool, CLARIFICATION_GATE } = await import("./tool.ts");
const { buildSelectItems, CUSTOM_ANSWER_VALUE } = await import("./question-items.ts");
const { isUiBusy } = await import("../shared/ui-lock.ts");

type AskQuestionTool = {
  parameters: {
    questions: {
      items: {
        options: { minItems: number; maxItems: number };
      };
      maxItems: number;
    };
  };
  promptGuidelines?: string[];
  execute: (
    toolCallId: string,
    params: {
      questions: Array<{
        question: string;
        header: string;
        details?: string;
        options?: Array<{ label: string; description: string }>;
        multiSelect?: boolean;
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

const YES_NO = [{ label: "Yes", description: "Release now" }, { label: "No", description: "Hold" }];

const ONE_QUESTION = {
  questions: [{ question: "Ship it?", header: "Ship", options: YES_NO }],
};

function described(...labels: string[]) {
  return labels.map((label) => ({ label, description: `${label} tradeoff` }));
}

const RPC_CONTEXT = { mode: "rpc", hasUI: true };

describe("ask_user_question prompt guidance", () => {
  test("states the whole clarification policy once, in the injected gate", () => {
    const injectedPrompt = CLARIFICATION_GATE;

    expect(injectedPrompt).toContain("MUST use ask_user_question");
    expect(injectedPrompt).toContain("Put the deciding context in each question's details field");
    expect(injectedPrompt).toContain("write each question so it can be answered on its own");
    expect(injectedPrompt).toContain("put the plan itself in the assistant response");
    expect(injectedPrompt).toContain("do not batch it with edit, write, bash, or other tool calls");
    expect(injectedPrompt).toContain("do not restate the details in prose");
    expect(injectedPrompt).toContain("interactive UI is unavailable");
    expect(injectedPrompt).toContain("do not infer answers");
    expect(injectedPrompt).toContain("offer two to four");
    expect(injectedPrompt).toContain("at most four questions");
    const { questions } = registerTool().parameters;
    expect([questions.items.options.minItems, questions.items.options.maxItems, questions.maxItems]).toEqual([2, 4, 4]);
  });

  test("permits read-only discovery before asking, and still gates consequential action", () => {
    expect(CLARIFICATION_GATE).toContain("Read-only discovery comes first");
    expect(CLARIFICATION_GATE).toContain("do not ask what that inspection answers");
    expect(CLARIFICATION_GATE).toContain("Before any consequential action");
    expect(CLARIFICATION_GATE).toContain("Inspection settles facts, not authorization");
    expect(CLARIFICATION_GATE).not.toContain("Before using any tool");
  });

  test("keeps tool guidance to option mechanics the gate omits", () => {
    const toolGuidance = registerTool().promptGuidelines ?? [];

    expect(toolGuidance).toHaveLength(1);
    expect(toolGuidance[0]).toContain("never by labelling it recommended");
    for (const guideline of toolGuidance) {
      expect(CLARIFICATION_GATE).not.toContain(guideline);
    }
  });
});

describe("ask_user_question outcomes", () => {
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

  test("uses the scrolling native selector for more than three TUI options", async () => {
    const select = mock((_title: string, options: string[]) => Promise.resolve(options[3]));
    const result = await registerTool().execute(
      "call-four-options",
      {
        questions: [{ question: "Pick one?", header: "Pick", options: described("One", "Two", "Three", "Four") }],
      },
      undefined,
      undefined,
      { mode: "tui", hasUI: true, ui: { select } },
    );

    expect(result.details.answers).toEqual([{ question: "Pick one?", answer: "Four", wasCustom: false }]);
  });

  test("asks free-text questions in the multi-line editor", async () => {
    const input = mock(() => Promise.resolve("unused"));
    const result = await registerTool().execute(
      "call-5",
      { questions: [{ question: "Name it?", header: "Name" }] },
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
            header: "Ship",
            details: "The release branch is already tagged.",
            options: YES_NO,
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
      ui: { select: () => new Promise<string>((resolve) => { releaseFirst = () => resolve("1. Yes — Release now"); }) },
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

  test("returns an ordered TUI multi-select answer with a custom value", async () => {
    const choices = ["[ ] 1. Unit — Unit tradeoff", "Write a different answer…", "Done selecting"];
    let call = 0;
    const result = await registerTool().execute(
      "call-multiple",
      { questions: [{ question: "Checks?", header: "Checks", multiSelect: true, options: described("Unit", "Integration", "Smoke", "Manual") }] },
      undefined,
      undefined,
      { mode: "tui", hasUI: true, ui: { select: () => Promise.resolve(choices[call++]), editor: () => Promise.resolve("Manual") } },
    );

    expect(result.details.answers).toEqual([{ question: "Checks?", answer: ["Unit", "Manual"], wasCustom: true }]);
  });

  test("removes a multi-select custom answer when it is resubmitted empty", async () => {
    const choices = ["[ ] 1. Unit — Unit tradeoff", "Write a different answer…", "Write a different answer…", "Done selecting"];
    const editorValues = ["Manual", ""];
    let choiceIndex = 0;
    let editorIndex = 0;
    const result = await registerTool().execute(
      "call-remove-custom",
      { questions: [{ question: "Checks?", header: "Checks", multiSelect: true, options: described("Unit", "Integration", "Smoke", "Lint") }] },
      undefined,
      undefined,
      {
        mode: "tui",
        hasUI: true,
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

  test("stages TUI multi-question answers until explicit confirmation and permits going back", async () => {
    const selections = ["1. First — First tradeoff", "Back to previous question", "2. Revised — Revised tradeoff", "1. Final — Final tradeoff", "Confirm answers"];
    let call = 0;
    const result = await registerTool().execute(
      "call-navigation",
      {
        questions: [
          { question: "First?", header: "First", options: described("First", "Revised", "Third", "Fourth") },
          { question: "Second?", header: "Second", options: described("Final", "Other final", "Third", "Fourth") },
        ],
      },
      undefined,
      undefined,
      { mode: "tui", hasUI: true, ui: { select: () => Promise.resolve(selections[call++]) } },
    );

    expect(result.details.answers).toEqual([
      { question: "First?", answer: "Revised", wasCustom: false },
      { question: "Second?", answer: "Final", wasCustom: false },
    ]);
  });

  // Paseo answers its one question form by replaying rpiv-ask-user-question's dialog order.
  test("follows the rpiv dialog order outside the TUI, without back or review dialogs", async () => {
    const dialogs: Array<{ method: string; options?: string[] }> = [];
    const replies = [
      (options: string[]) => options[1],
      () => "1,2",
      (options: string[]) => options[2],
      () => "Nebula",
    ];
    let call = 0;
    const result = await registerTool().execute(
      "call-rpiv",
      {
        questions: [
          { question: "Which snack?", header: "Snack", options: described("Apple", "Cookie") },
          { question: "Which colors?", header: "Colors", multiSelect: true, options: described("Red", "Blue") },
          { question: "What project name?", header: "Project", options: described("Atlas", "Beacon") },
        ],
      },
      undefined,
      undefined,
      {
        ...RPC_CONTEXT,
        ui: {
          select: (_title: string, options: string[]) => {
            dialogs.push({ method: "select", options });
            return Promise.resolve(replies[call++](options));
          },
          input: () => {
            dialogs.push({ method: "input" });
            return Promise.resolve(replies[call++]([]));
          },
        },
      },
    );

    expect(dialogs.map(({ method }) => method)).toEqual(["select", "input", "select", "input"]);
    expect(dialogs[0].options).toEqual(["1. Apple \u2014 Apple tradeoff", "2. Cookie \u2014 Cookie tradeoff", "3. Write a different answer\u2026"]);
    expect(result.details.answers).toEqual([
      { question: "Which snack?", answer: "Cookie", wasCustom: false },
      { question: "Which colors?", answer: ["Red", "Blue"], wasCustom: false },
      { question: "What project name?", answer: "Nebula", wasCustom: true },
    ]);
  });

  test("splits a multi-select reply that mixes labels and typed text", async () => {
    const result = await registerTool().execute(
      "call-rpiv-mixed",
      { questions: [{ question: "Checks?", header: "Checks", multiSelect: true, options: described("Unit", "Smoke") }] },
      undefined,
      undefined,
      { ...RPC_CONTEXT, ui: { input: () => Promise.resolve("Smoke, Manual, then review") } },
    );

    expect(result.details.answers).toEqual([{ question: "Checks?", answer: ["Smoke", "Manual, then review"], wasCustom: true }]);
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
