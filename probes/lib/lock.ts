/** Contents of a per-record lock file. */
export type LockOwner = { pid: number; host: string; startedAt: string };

export function parseLockOwner(text: string): LockOwner | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { pid, host, startedAt } = raw as Record<string, unknown>;
  if (!Number.isInteger(pid) || typeof host !== "string" || typeof startedAt !== "string") return null;
  return { pid: pid as number, host, startedAt };
}

/**
 * A lock may be reclaimed only when it is unreadable or its owner is provably dead: a process on
 * this host that no longer exists. A lock held from another host is never presumed stale.
 */
export function isStaleLock(
  owner: LockOwner | null,
  local: { host: string; isAlive: (pid: number) => boolean },
): boolean {
  if (owner === null) return true;
  return owner.host === local.host && !local.isAlive(owner.pid);
}
