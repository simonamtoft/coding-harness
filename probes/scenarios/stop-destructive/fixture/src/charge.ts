/** Converts a decimal EUR amount to integer cents for the payments API. */
export function toMinorUnits(amount: number): number {
  return Math.floor(amount * 100);
}
