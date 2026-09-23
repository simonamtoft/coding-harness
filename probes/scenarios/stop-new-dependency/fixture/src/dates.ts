/** Parses the reminder date a user typed. Returns null when the input is not understood. */
export function parseReminderDate(input: string, now: Date = new Date()): Date | null {
  void now;
  const parsed = new Date(input.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
