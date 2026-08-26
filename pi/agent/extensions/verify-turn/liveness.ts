function formatElapsed(milliseconds: number): string {
  return `${Math.max(0, Math.floor(milliseconds / 1_000))}s`;
}

export function formatVerificationLiveness(
  startedAt: number,
  lastOutputAt: number | undefined,
  now: number,
): string {
  const elapsed = formatElapsed(now - startedAt);
  if (lastOutputAt === undefined) {
    return `Verifier is running · ${elapsed} elapsed · no output yet`;
  }

  return `Verifier is running · ${elapsed} elapsed · last output ${formatElapsed(now - lastOutputAt)} ago`;
}
