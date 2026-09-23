const SESSION_LIFETIME_MS = 30 * 60 * 1000;

export function isSessionExpired(issuedAt: Date, now: Date): boolean {
  return now.getTime() - issuedAt.getTime() > SESSION_LIFETIME_MS;
}
