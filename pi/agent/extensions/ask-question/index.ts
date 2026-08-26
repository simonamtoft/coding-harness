import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const CLARIFICATION_GATE = `Clarification gate (mandatory): Before using any tool, decide whether the request leaves unresolved choices that could materially change scope, behavior, user experience, data design, dependencies, destructive effects, or acceptance criteria. If it does, collect all closely related blocking questions into one ask_question call before acting. Before the ask_question call, write a concise context block in the same assistant response that states what decision is needed and includes the key facts or proposal the question refers to. The user must be able to understand the question and options without relying on hidden reasoning. If asking approval of a plan, include the plan. Apart from that context block, the response must contain only the ask_question call—do not batch it with other tool calls. Provide concrete options when useful, while always allowing a free-text answer. Do not silently choose a reasonable default. Do not ask when repository inspection can resolve the choice.`;

const QuestionSchema = Type.Object({
  question: Type.String({ description: "The specific question to ask the user" }),
  options: Type.Optional(
    Type.Array(Type.String(), {
      description: "Up to three concrete choices. The user can always write a different answer.",
      maxItems: 3,
    }),
  ),
  recommended: Type.Optional(
    Type.String({ description: "The recommended option or answer, with a brief reason" }),
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

export default function askQuestionExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${CLARIFICATION_GATE}`,
  }));

  pi.registerTool({
    name: "ask_question",
    label: "Ask Question",
    description:
      "Ask the user one or more blocking clarification questions before work continues. Each question may offer choices and always permits a free-text answer.",
    promptSnippet: "Give the decision context, then ask one or more blocking clarification questions with optional choices",
    promptGuidelines: [
      "Call ask_question before acting when unresolved choices could materially change scope, behavior, user experience, data design, dependencies, destructive effects, or acceptance criteria.",
      "Immediately before ask_question, write a concise visible context block in the same assistant response. State the decision needed and the key facts or proposal behind the options; if asking approval of a plan, include the plan.",
      "When clarification is required, collect all closely related blocking questions into one ask_question call, and do not batch it with edit, write, bash, or other tool calls.",
      "Before using ask_question, inspect the repository when it can answer the questions.",
      "For each question, offer at most three concrete options, recommend one when possible, and allow the user to write a different answer.",
      "If ask_question reports cancellation or unavailable UI, do not infer answers or continue with the blocked decisions.",
    ],
    parameters: AskQuestionParams,
    prepareArguments(args) {
      if (!args || typeof args !== "object") return args;
      const legacy = args as {
        questions?: unknown;
        question?: unknown;
        options?: unknown;
        recommended?: unknown;
        placeholder?: unknown;
      };
      if (legacy.questions !== undefined || typeof legacy.question !== "string") return args;
      return {
        questions: [
          {
            question: legacy.question,
            ...(Array.isArray(legacy.options) ? { options: legacy.options } : {}),
            ...(typeof legacy.recommended === "string" ? { recommended: legacy.recommended } : {}),
            ...(typeof legacy.placeholder === "string" ? { placeholder: legacy.placeholder } : {}),
          },
        ],
      };
    },
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          content: [
            {
              type: "text",
              text: "Interactive UI is unavailable. Ask the questions in the assistant response and stop until the user answers.",
            },
          ],
          details: { questions: params.questions, answers: [], cancelled: true },
        };
      }

      const answers: Array<{ question: string; answer: string; wasCustom: boolean }> = [];

      for (const [index, question] of params.questions.entries()) {
        const prefix = params.questions.length > 1 ? `Question ${index + 1} of ${params.questions.length}\n` : "";
        const title = question.recommended
          ? `${prefix}${question.question}\nRecommended: ${question.recommended}`
          : `${prefix}${question.question}`;
        const options = question.options?.filter((option) => option.trim().length > 0) ?? [];

        let answer: string | undefined;
        let wasCustom = false;

        if (options.length > 0) {
          const displayedOptions = options.map(
            (option, optionIndex) =>
              `${optionIndex + 1}. ${option}${option === question.recommended ? " (recommended)" : ""}`,
          );
          const customChoice = `${displayedOptions.length + 1}. Write a different answer…`;
          const selected = await ctx.ui.select(title, [...displayedOptions, customChoice]);

          if (selected === customChoice) {
            const input = await ctx.ui.input(question.question, question.placeholder);
            answer = input?.trim() || undefined;
            wasCustom = true;
          } else if (selected !== undefined) {
            answer = options[displayedOptions.indexOf(selected)];
          }
        } else {
          const input = await ctx.ui.input(title, question.placeholder);
          answer = input?.trim() || undefined;
          wasCustom = true;
        }

        if (answer === undefined) {
          return {
            content: [{ type: "text", text: "The user cancelled without answering all questions." }],
            details: { questions: params.questions, answers, cancelled: true },
          };
        }

        answers.push({ question: question.question, answer, wasCustom });
      }

      const summary = answers
        .map(({ question, answer }, index) => `${index + 1}. ${question}\nAnswer: ${answer}`)
        .join("\n\n");

      return {
        content: [{ type: "text", text: summary }],
        details: { questions: params.questions, answers, cancelled: false },
      };
    },
  });
}
