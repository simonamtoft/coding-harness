export function cartTotal(lineCents: number[]): number {
  return lineCents.reduce((sum, cents) => sum + cents, 0);
}
