export interface PanelItem {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionSpec {
  question: string;
  details?: string;
  options?: QuestionOption[];
  placeholder?: string;
}

export interface PanelAnswer {
  answer: string;
  wasCustom: boolean;
}

export const CUSTOM_ANSWER_VALUE = "custom";

const CUSTOM_ANSWER_LABEL = "Write a different answer…";

/** Options keep the order the model gave them: most recommended first. */
export function buildSelectItems(options: QuestionOption[]): PanelItem[] {
  const items: PanelItem[] = options.map((option, index) => ({
    value: String(index),
    label: `${index + 1}. ${option.label}`,
    ...(option.description ? { description: option.description } : {}),
  }));
  items.push({ value: CUSTOM_ANSWER_VALUE, label: `${options.length + 1}. ${CUSTOM_ANSWER_LABEL}` });
  return items;
}

export function buildHeading(question: string, position?: { index: number; total: number }): string {
  if (!position || position.total < 2) return question;
  return `Question ${position.index + 1} of ${position.total}: ${question}`;
}
