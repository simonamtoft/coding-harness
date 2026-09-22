import { formatAmount } from "./format.ts";

export type Line = { label: string; cents: number };

export function renderReceipt(lines: Line[]): string {
  const body = lines.map((l) => `${l.label}: ${formatAmount(l.cents)}`).join("\n");
  const total = lines.reduce((sum, l) => sum + l.cents, 0);
  return `${body}\nTotal: ${formatAmount(total)}`;
}
