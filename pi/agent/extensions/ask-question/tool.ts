import { Type } from "typebox";
import { withUiLock } from "../shared/ui-lock.ts";
import { buildHeading, type PanelAnswer, type QuestionOption, type QuestionSpec } from "./question-items.ts";
import type { askWithPanel } from "./question-panel.ts";

type AskContext = Parameters<typeof askWithPanel>[0] & {
  mode: string;
  ui: {
    select: (title: string, options: string[]) => Promise<string | undefined>;
    input: (title: string, placeholder?: string) => Promise<string | undefined>;
    editor: (title: string, prefill?: string) => Promise<string | undefined>;
  };
};

export const CLARIFICATION_GATE = `Clarification gate (mandatory): Before using any tool, decide whether the request leaves unresolved choices that could materially change scope, behavior, user experience, data design, dependencies, destructive effects, or acceptance criteria. If it does, collect all closely related blocking questions into one ask_question call before acting. Put the deciding context in each question's details field: the key facts, constraints, or tradeoffs the user needs to choose without relying on hidden reasoning. When asking approval of a plan, put the plan itself in the assistant response, because a plan is too long to read inside the question. Otherwise the response must contain only the ask_question call—do not batch it with other tool calls or restate the details in prose. Provide concrete options when useful, ordered best first so the leading option is the one you recommend, while always allowing a free-text answer. Do not silently choose a reasonable default. Do not ask when repository inspection can resolve the choice.`;

const OptionSchema = Type.Object({
  label: Type.String({ description: "Short label for the choice" }),
  description: Type.Optional(
    Type.String({ description: "One line naming the consequence or tradeoff of this choice" }),
  ),
});

const QuestionSchema = Type.Object({
  question: Type.String({ description: "The specific question to ask the user" }),
  details: Type.Optional(
    Type.String({
      description:
        "The context needed to decide: key facts, constraints, or tradeoffs. Shown under the question and kept in the transcript.",
    }),
  ),
  options: Type.Optional(
    Type.Array(OptionSchema, {
      description:
        "Up to three concrete choices, ordered best first: the leading option is the one you recommend. The user can always write a different answer.",
      maxItems: 3,
    }),
  ),
  placeholder: Type.Optional(
    Type.String({ description: "Placeholder shown for a free-text answer" }),
  ),
});

const AskQuestionParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    description: "One or more closely related questions that must be answered before continuing",
    minItems: 1,
  }),
});

function normalizeOptions(options: unknown[]): QuestionOption[] {
  return options.map((option) => (typeof option === "string" ? { label: option } : (option as QuestionOption)));
}

/** Accepts the shapes models reach for out of habit: string options, and a recommended field that ordering replaced. */
function normalizeQuestion(question: unknown): unknown {
  if (!question || typeof question !== "object") return question;
  const { recommended: _dropped, ...rest } = question as { recommended?: unknown; options?: unknown };
  return Array.isArray(rest.options) ? { ...rest, options: normalizeOptions(rest.options) } : rest;
}

function buildTitle(question: QuestionSpec, position: { index: number; total: number }): string {
  const lines = [buildHeading(question.question, position)];
  if (question.details) lines.push(question.details);
  if (question.placeholder) lines.push(question.placeholder);
  return lines.join("\n");
}

/** Fallback for RPC and other non-TUI modes, where ctx.ui.custom() resolves to undefined. */
async function askWithSelect(
  ctx: AskContext,
  question: QuestionSpec,
  options: QuestionOption[],
  position: { index: number; total: number },
): Promise<PanelAnswer | undefined> {
  const displayedOptions = options.map(
    (option, index) => `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`,
  );
  const customChoice = `${displayedOptions.length + 1}. Write a different answer…`;
  const selected = await ctx.ui.select(buildTitle(question, position), [...displayedOptions, customChoice]);

  if (selected === undefined) return undefined;
  if (selected !== customChoice) {
    return { answer: options[displayedOptions.indexOf(selected)].label, wasCustom: false };
  }

  const answer = (await ctx.ui.input(question.question, question.placeholder))?.trim();
  return answer ? { answer, wasCustom: true } : undefined;
}

async function askOneQuestion(
  ctx: AskContext,
  question: QuestionSpec,
  position: { index: number; total: number },
): Promise<PanelAnswer | undefined> {
  const options = (question.options ?? []).filter((option) => option.label.trim().length > 0);

  if (options.length === 0) {
    const answer = (await ctx.ui.editor(buildTitle(question, position)))?.trim();
    return answer ? { answer, wasCustom: true } : undefined;
  }

  if (ctx.mode !== "tui") return askWithSelect(ctx, question, options, position);

  // Loaded on demand so non-TUI modes never pull in the TUI component tree.
  const { askWithPanel } = await import("./question-panel.ts");
  return askWithPanel(ctx, { ...question, options }, position);
}

export const askQuestionTool = {
  name: "ask_question",
  label: "Ask Question",
  description:
    "Ask the user one or more blocking clarification questions before work continues. Each question may offer choices and always permits a free-text answer.",
  promptSnippet:
    "Give the decision context, then ask one or more blocking clarification questions with optional choices",
  promptGuidelines: [
    "Call ask_question before acting when unresolved choices could materially change scope, behavior, user experience, data design, dependencies, destructive effects, or acceptance criteria.",
    "Give each ask_question question a details field stating the decision needed and the key facts or tradeoffs behind the options; write the assistant response prose only when approving a plan, which belongs in the message rather than the question.",
    "When clarification is required, collect all closely related blocking questions into one ask_question call, and do not batch it with edit, write, bash, or other tool calls.",
    "Do not repeat ask_question details in prose; the user sees them with the question.",
    "Before using ask_question, inspect the repository when it can answer the questions.",
    "For each ask_question question, offer at most three concrete options ordered best first, and allow the user to write a different answer.",
    "State why the leading ask_question option leads in its description or in the question details, never by labelling it recommended.",
    "Keep ask_question option labels short and put the tradeoff in the option description instead of the label.",
    "If ask_question reports cancellation or unavailable UI, do not infer answers or continue with the blocked decisions.",
  ],
  parameters: AskQuestionParams,
  prepareArguments(args: unknown) {
    if (!args || typeof args !== "object") return args;
    const legacy = args as {
      questions?: unknown;
      question?: unknown;
      options?: unknown;
      placeholder?: unknown;
    };
    if (Array.isArray(legacy.questions)) {
      return { ...legacy, questions: legacy.questions.map(normalizeQuestion) };
    }
    if (legacy.questions !== undefined || typeof legacy.question !== "string") return args;
    return {
      questions: [
        {
          question: legacy.question,
          ...(Array.isArray(legacy.options) ? { options: normalizeOptions(legacy.options) } : {}),
          ...(typeof legacy.placeholder === "string" ? { placeholder: legacy.placeholder } : {}),
        },
      ],
    };
  },
  executionMode: "sequential" as const,

  async execute(
    _toolCallId: string,
    params: { questions: QuestionSpec[] },
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: AskContext & { hasUI: boolean },
  ) {
    if (signal?.aborted) {
      return {
        content: [{ type: "text", text: "The turn was aborted before the questions were asked." }],
        details: { status: "cancelled", questions: params.questions, answers: [] },
      };
    }

    if (!ctx.hasUI) {
      return {
        content: [
          {
            type: "text",
            text: "Interactive UI is unavailable. Ask the questions in the assistant response and stop until the user answers.",
          },
        ],
        details: { status: "unavailable", questions: params.questions, answers: [] },
      };
    }

    // Held across every question so a second pop-up cannot steal terminal input mid-run.
    return withUiLock(async () => {
      const answers: Array<{ question: string; answer: string; wasCustom: boolean }> = [];

      for (const [index, question] of params.questions.entries()) {
        const position = { index, total: params.questions.length };
        const result = await askOneQuestion(ctx, question, position);

        if (!result) {
          return {
            content: [{ type: "text", text: "The user cancelled without answering all questions." }],
            details: { status: "cancelled", questions: params.questions, answers },
          };
        }

        answers.push({ question: question.question, ...result });
      }

      const summary = answers
        .map(({ question, answer }, index) => {
          const details = params.questions[index].details;
          return `${index + 1}. ${question}${details ? `\n${details}` : ""}\nAnswer: ${answer}`;
        })
        .join("\n\n");

      return {
        content: [{ type: "text", text: summary }],
        details: { status: "answered", questions: params.questions, answers },
      };
    });
  },
};
