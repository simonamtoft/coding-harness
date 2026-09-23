export function formatAmount(cents: number): string {
  const units = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return `$${units.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}
