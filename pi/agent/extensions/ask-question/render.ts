import { Text } from "@earendil-works/pi-tui";
import type { QuestionSpec } from "./question-items.ts";

type Theme = { fg: (color: string, text: string) => string; bold: (text: string) => string };

interface AskQuestionDetails {
  status: "answered" | "cancelled" | "unavailable";
  questions: QuestionSpec[];
  answers: Array<{ question: string; answer: string; wasCustom: boolean }>;
}

export function renderCall(args: { questions?: QuestionSpec[] }, theme: Theme): Text {
  const questions = args.questions ?? [];
  const [first] = questions;
  const suffix = questions.length > 1 ? theme.fg("dim", ` +${questions.length - 1} more`) : "";
  const title = theme.fg("toolTitle", theme.bold("ask_question "));

  if (!first) return new Text(title, 0, 0);

  const options = (first.options ?? []).map((option) => option.label);
  const optionLine =
    options.length > 0 ? `\n${theme.fg("dim", `  ${options.join(" • ")} • or a different answer`)}` : "";

  return new Text(`${title}${theme.fg("muted", first.question)}${suffix}${optionLine}`, 0, 0);
}

export function renderResult(
  result: { content: Array<{ type: string; text?: string }>; details?: AskQuestionDetails },
  { expanded }: { expanded?: boolean },
  theme: Theme,
): Text {
  const details = result.details;
  // Results stored before status existed carry `cancelled: true` instead; their
  // own text still describes the outcome.
  if (!details?.status) {
    const [first] = result.content;
    return new Text(first?.text ?? "", 0, 0);
  }

  if (details.status === "unavailable") {
    return new Text(theme.fg("warning", "No interactive UI — questions were not asked"), 0, 0);
  }
  if (details.status === "cancelled") {
    return new Text(theme.fg("warning", "Cancelled without answering"), 0, 0);
  }

  const lines = details.answers.map(({ question, answer, wasCustom }, index) => {
    const marker = theme.fg("success", "✓ ");
    const shown = wasCustom ? `${theme.fg("muted", "custom: ")}${theme.fg("accent", answer)}` : theme.fg("accent", answer);
    if (!expanded) return `${marker}${shown}`;

    const asked = details.questions[index]?.details;
    const context = asked ? `\n  ${theme.fg("dim", asked)}` : "";
    return `${marker}${theme.fg("muted", question)}${context}\n  ${shown}`;
  });

  return new Text(lines.join("\n"), 0, 0);
}
