import type { ExtensionMode } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { withUiLock } from "../shared/ui-lock.ts";
import {
  buildHeading,
  type AnswerValue,
  type PanelAnswer,
  type PanelResult,
  type QuestionOption,
  type QuestionSpec,
} from "./question-items.ts";
import type { askWithPanel } from "./question-panel.ts";

type AskContext = Parameters<typeof askWithPanel>[0] & {
  mode: string;
  ui: {
    select: (title: string, options: string[]) => Promise<string | undefined>;
    input: (title: string, placeholder?: string) => Promise<string | undefined>;
    editor: (title: string, prefill?: string) => Promise<string | undefined>;
  };
};

type RecordedAnswer = { question: string; answer: AnswerValue; wasCustom: boolean };
type QuestionResult = PanelAnswer | "back" | undefined;

const GATE_POLICY = `Clarification gate (mandatory): Read-only discovery comes first. Inspect the repository whenever files, tests, or conventions can resolve an uncertainty, and do not ask what that inspection answers. Before any consequential action, including edits, writes, commands with effects, and committing to an approach, decide whether unresolved choices remain that could materially change scope, behavior, user experience, data design, dependencies, destructive effects, or acceptance criteria. If they do, collect all closely related blocking questions into one ask_user_question call before acting. Inspection settles facts, not authorization: when a request that deletes, overwrites, or discards work leaves its scope ambiguous, confirm the scope before acting even if inspection suggests a plausible target. You MUST use ask_user_question for every such question; never ask it as ordinary assistant prose unless ask_user_question reports that interactive UI is unavailable, in which case ask in the assistant response and stop until the user answers. If ask_user_question reports cancellation or unavailable UI, do not infer answers or continue with the blocked decisions.`;

const GATE_LIMITS = `Ask at most four questions per call. Provide concrete options only when useful; when you do, offer two to four, each with a description, order them best first so the leading option is the one you recommend, and always allow a free-text answer. Do not silently choose a reasonable default.`;

const CONTEXT_IN_DETAILS = `Put the deciding context in each question's details field: the key facts, constraints, or tradeoffs the user needs to choose without relying on hidden reasoning. Also write each question so it can be answered on its own, because some clients show only the question, its header, and the option descriptions, not details. When asking approval of a plan, put the plan itself in the assistant response, because a plan is too long to read inside the question. Otherwise the response must contain only the ask_user_question call—do not batch it with edit, write, bash, or other tool calls, and do not restate the details in prose.`;

// Paseo's native question form (RPC mode) never renders the details field (ASK-09).
const CONTEXT_IN_PROSE = `This client's question form shows only each question, its header, and the option descriptions, not the details field. Before the ask_user_question call, write the deciding context in the assistant response: the key facts, constraints, or tradeoffs the user needs to choose without relying on hidden reasoning, grouped by question, plus any plan you are asking to approve. Keep it brief and write each question so it can be answered on its own. Do not batch the call with edit, write, bash, or other tool calls.`;

export function clarificationGate(mode: ExtensionMode): string {
  const contextRule = mode === "tui" ? CONTEXT_IN_DETAILS : CONTEXT_IN_PROSE;
  return `${GATE_POLICY} ${contextRule} ${GATE_LIMITS}`;
}

// Paseo shows its native question form only for calls whose raw arguments match the
// rpiv-ask-user-question shape (name, header, 2–4 described options, at most 4 questions,
// multiSelect). Other valid calls fall back to one generic card per dialog.
const OptionSchema = Type.Object({
  label: Type.String({ description: "Short label for the choice; unique within the question and not 'Other', 'Type something.', or 'Next'" }),
  description: Type.String({ description: "One line naming the consequence or tradeoff of this choice" }),
});

const QuestionSchema = Type.Object({
  question: Type.String({ description: "The specific question, answerable on its own without details" }),
  header: Type.String({ description: "Short tag of one or two words naming the question; unique within the call" }),
  details: Type.Optional(Type.String({ description: "The context needed to decide: key facts, constraints, or tradeoffs. Shown under the question in the terminal and kept in the transcript." })),
  options: Type.Optional(Type.Array(OptionSchema, { description: "Optional concrete choices: two to four, ordered best first so the leading option is the one you recommend. The user can always write a different answer.", minItems: 2, maxItems: 4 })),
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow choosing multiple options. The answer is returned as an ordered list." })),
  placeholder: Type.Optional(Type.String({ description: "Placeholder shown for a free-text answer" })),
});

const AskQuestionParams = Type.Object({
  questions: Type.Array(QuestionSchema, { description: "One to four closely related questions that must be answered before continuing", minItems: 1, maxItems: 4 }),
});

function buildTitle(question: QuestionSpec, position: { index: number; total: number }): string {
  return [buildHeading(question.question, position), question.details, question.placeholder].filter(Boolean).join("\n");
}

function cancelledResult(questions: QuestionSpec[], text = "The user cancelled without answering all questions.") {
  return { content: [{ type: "text" as const, text }], details: { status: "cancelled" as const, questions, answers: [] } };
}

async function askWithSelect(
  ctx: AskContext,
  question: QuestionSpec,
  options: QuestionOption[],
  position: { index: number; total: number },
  allowBack: boolean,
): Promise<QuestionResult> {
  const title = buildTitle(question, position);
  if (!question.multiSelect) {
    const displayed = options.map((option, index) => `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`);
    const custom = `${displayed.length + 1}. Write a different answer…`;
    const back = "Back to previous question";
    const selected = await ctx.ui.select(title, [...displayed, custom, ...(allowBack ? [back] : [])]);
    if (!selected) return undefined;
    if (selected === back) return "back";
    if (selected !== custom) return { answer: options[displayed.indexOf(selected)].label, wasCustom: false };
    const answer = (await ctx.ui.input(question.question, question.placeholder))?.trim();
    return answer ? { answer, wasCustom: true } : undefined;
  }

  const selected = new Set<number>();
  let customAnswer: string | undefined;
  while (true) {
    const displayed = options.map((option, index) => `${selected.has(index) ? "[x]" : "[ ]"} ${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`);
    const custom = "Write a different answer…";
    const done = "Done selecting";
    const back = "Back to previous question";
    const choice = await ctx.ui.select(title, [...displayed, custom, done, ...(allowBack ? [back] : [])]);
    if (!choice) return undefined;
    if (choice === back) return "back";
    if (choice === done) {
      const answer = [...options.filter((_option, index) => selected.has(index)).map((option) => option.label), ...(customAnswer ? [customAnswer] : [])];
      if (answer.length > 0) return { answer, wasCustom: customAnswer !== undefined };
      continue;
    }
    if (choice === custom) {
      const answer = await ctx.ui.editor(question.question, customAnswer);
      if (answer !== undefined) customAnswer = answer.trim() || undefined;
      continue;
    }
    const index = displayed.indexOf(choice);
    selected.has(index) ? selected.delete(index) : selected.add(index);
  }
}

function parseMultiAnswer(reply: string, options: QuestionOption[]): PanelAnswer | undefined {
  const numbers = /^\s*\d+(\s*,\s*\d+)*\s*$/.test(reply) ? reply.split(",").map((part) => Number(part.trim()) - 1) : undefined;
  if (numbers?.every((index) => index >= 0 && index < options.length)) {
    return { answer: [...new Set(numbers)].map((index) => options[index].label), wasCustom: false };
  }
  // Paseo sends a multi-select answer that includes typed text as labels and text joined by ", ".
  const labels = options.map((option) => option.label);
  const parts = reply.split(", ");
  const selected = parts.filter((part) => labels.includes(part));
  const custom = parts.filter((part) => !labels.includes(part)).join(", ").trim();
  const answer = [...selected, ...(custom ? [custom] : [])];
  return answer.length > 0 ? { answer, wasCustom: custom.length > 0 } : undefined;
}

/**
 * Dialog order for non-TUI clients. It matches rpiv-ask-user-question, whose order Paseo
 * replays to answer every dialog from its one question form: no back or review dialogs,
 * the custom answer is the select entry after the options, and multi-select is one input.
 */
async function askOverDialogs(ctx: AskContext, question: QuestionSpec, options: QuestionOption[], position: { index: number; total: number }): Promise<PanelAnswer | undefined> {
  const title = buildTitle(question, position);
  if (options.length === 0) {
    const answer = (await ctx.ui.editor(title))?.trim();
    return answer ? { answer, wasCustom: true } : undefined;
  }
  const displayed = options.map((option, index) => `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`);
  if (question.multiSelect) {
    const reply = (await ctx.ui.input(`${title}\n\n${displayed.join("\n")}\n\nEnter the numbers of all that apply, comma-separated (e.g. "1,3"), or type a custom answer as plain text.`, "1,3"))?.trim();
    return reply ? parseMultiAnswer(reply, options) : undefined;
  }
  const custom = `${displayed.length + 1}. Write a different answer…`;
  const selected = await ctx.ui.select(title, [...displayed, custom]);
  if (!selected) return undefined;
  if (selected !== custom) return { answer: options[displayed.indexOf(selected)].label, wasCustom: false };
  const answer = (await ctx.ui.input(question.question, question.placeholder))?.trim();
  return answer ? { answer, wasCustom: true } : undefined;
}

async function askOneQuestion(ctx: AskContext, question: QuestionSpec, position: { index: number; total: number }, allowBack: boolean): Promise<QuestionResult> {
  const options = (question.options ?? []).filter((option) => option.label.trim().length > 0);
  if (ctx.mode !== "tui") return askOverDialogs(ctx, question, options, position);
  // The custom panel has no vertical viewport; Pi's native selector scrolls longer lists.
  if (options.length <= 3) {
    const { askWithPanel } = await import("./question-panel.ts");
    return askWithPanel(ctx, { ...question, options }, position, allowBack);
  }
  if (options.length > 0) return askWithSelect(ctx, question, options, position, allowBack);
  if (allowBack) {
    const choice = await ctx.ui.select(buildTitle(question, position), ["Write a different answer…", "Back to previous question"]);
    if (!choice) return undefined;
    if (choice === "Back to previous question") return "back";
  }
  const answer = (await ctx.ui.editor(buildTitle(question, position)))?.trim();
  return answer ? { answer, wasCustom: true } : undefined;
}

async function confirmAnswers(ctx: AskContext, answers: RecordedAnswer[]): Promise<"confirm" | "back" | undefined> {
  const summary = answers.map(({ question, answer }) => `${question}\nAnswer: ${Array.isArray(answer) ? answer.join(", ") : answer}`).join("\n\n");
  const choice = await ctx.ui.select(`Review your answers:\n${summary}`, ["Confirm answers", "Back to last question"]);
  if (choice === "Confirm answers") return "confirm";
  if (choice === "Back to last question") return "back";
  return undefined;
}

export const askQuestionTool = {
  name: "ask_user_question",
  label: "Ask Question",
  description: "Ask the user one or more blocking clarification questions before work continues. Each question may offer choices and always permits a free-text answer.",
  promptSnippet: "Give the decision context, then ask one or more blocking clarification questions with optional choices",
  // The clarification policy itself is injected once by clarificationGate; keep these to option mechanics it omits.
  promptGuidelines: [
    "Keep ask_user_question option labels short and put the tradeoff in the option description; say why the leading option leads there or in the question details, never by labelling it recommended.",
  ],
  parameters: AskQuestionParams,
  executionMode: "sequential" as const,

  async execute(_toolCallId: string, params: { questions: QuestionSpec[] }, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: AskContext & { hasUI: boolean }) {
    if (signal?.aborted) return cancelledResult(params.questions, "The turn was aborted before the questions were asked.");
    if (!ctx.hasUI) return { content: [{ type: "text" as const, text: "Interactive UI is unavailable. Ask the questions in the assistant response and stop until the user answers." }], details: { status: "unavailable" as const, questions: params.questions, answers: [] } };

    return withUiLock(async () => {
      if (signal?.aborted) return cancelledResult(params.questions, "The turn was aborted before the questions were asked.");
      const answers: RecordedAnswer[] = [];
      let index = 0;
      while (true) {
        while (index < params.questions.length) {
          if (signal?.aborted) return cancelledResult(params.questions, "The turn was aborted before the questions were asked.");
          const question = params.questions[index];
          const result = await askOneQuestion(ctx, question, { index, total: params.questions.length }, index > 0);
          if (!result) return cancelledResult(params.questions);
          if (result === "back") {
            index -= 1;
            answers.pop();
            continue;
          }
          answers[index] = { question: question.question, ...result };
          index += 1;
        }

        if (params.questions.length === 1 || ctx.mode !== "tui") break;
        if (signal?.aborted) return cancelledResult(params.questions, "The turn was aborted before the questions were asked.");
        const confirmation = await confirmAnswers(ctx, answers);
        if (!confirmation) return cancelledResult(params.questions);
        if (confirmation === "confirm") break;
        index -= 1;
        answers.pop();
      }

      const summary = answers.map(({ question, answer }, answerIndex) => `${answerIndex + 1}. ${question}${params.questions[answerIndex].details ? `\n${params.questions[answerIndex].details}` : ""}\nAnswer: ${Array.isArray(answer) ? answer.join(", ") : answer}`).join("\n\n");
      return { content: [{ type: "text" as const, text: summary }], details: { status: "answered" as const, questions: params.questions, answers } };
    });
  },
};
