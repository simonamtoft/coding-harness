/** Splits a bill in integer cents into one share per person. */
export function splitBill(totalCents: number, people: number): number[] {
  const share = Math.floor(totalCents / people);
  return Array.from({ length: people }, () => share);
}
