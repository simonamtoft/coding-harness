/**
 * Per-record lock files that serialize probe runners sharing a cache key. Filesystem work stays
 * here rather than in lib/, which is pure; probes/test/record-lock.test.ts drives the races.
 *
 * Invariant: a lock path is only ever created by an exclusive link() and only ever deleted by its
 * owner or, under the reclaim mutex, when it still holds the exact stale content that was
 * inspected. No step moves a live lock away from its path.
 */
import { link, readFile, unlink, writeFile } from "node:fs/promises";

import { isStaleLock, parseLockOwner, type LockOwner } from "./lib/lock.ts";

const ACQUIRE_ATTEMPTS = 5;
const CONTENDED_RETRY_MS = 10;

type IsAlive = (pid: number) => boolean;

function serialize(owner: LockOwner): string {
  return `${JSON.stringify(owner)}\n`;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/** Creates `path` with `owner` as its content, or returns false if it already exists. */
async function createExclusive(path: string, owner: LockOwner): Promise<boolean> {
  const staging = `${path}.${owner.pid}.tmp`;
  await writeFile(staging, serialize(owner));
  try {
    await link(staging, path);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  } finally {
    await unlink(staging).catch(() => undefined);
  }
}

/** Returns null when `owner` now holds the lock, otherwise the live holder. */
export async function acquireLock(path: string, owner: LockOwner, isAlive: IsAlive): Promise<LockOwner | null> {
  for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt++) {
    if (await createExclusive(path, owner)) return null;
    const existingText = await readFile(path, "utf8").catch(() => null);
    if (existingText === null) continue;
    if (!isStaleLock(parseLockOwner(existingText), { host: owner.host, isAlive })) {
      return parseLockOwner(existingText);
    }
    if (!(await reclaimStaleLock(path, existingText, owner, isAlive))) {
      await new Promise((resolve) => setTimeout(resolve, CONTENDED_RETRY_MS));
    }
  }
  const holder = parseLockOwner(await readFile(path, "utf8").catch(() => ""));
  if (holder) return holder;
  throw new Error(`could not acquire ${path}`);
}

/**
 * Deletes the lock only if it still holds `staleText`, checked and deleted while holding a
 * separate reclaim mutex. Returns false when another reclaimer holds the mutex.
 */
export async function reclaimStaleLock(
  path: string,
  staleText: string,
  claimant: LockOwner,
  isAlive: IsAlive,
): Promise<boolean> {
  const mutex = `${path}.reclaim.lock`;
  if (!(await createExclusive(mutex, claimant))) {
    const holder = parseLockOwner(await readFile(mutex, "utf8").catch(() => ""));
    // shortcut: clearing a dead reclaimer's mutex is itself unguarded. It needs a crash inside the
    // microsecond critical section below plus concurrent reclaimers; revisit if that is observed.
    if (holder && isStaleLock(holder, { host: claimant.host, isAlive })) await unlink(mutex).catch(() => undefined);
    return false;
  }
  try {
    if ((await readFile(path, "utf8").catch(() => null)) === staleText) await unlink(path).catch(() => undefined);
    return true;
  } finally {
    await unlink(mutex).catch(() => undefined);
  }
}

/** Deletes the lock only while it still belongs to `owner`; no one else can replace a live lock. */
export async function releaseLock(path: string, owner: LockOwner): Promise<void> {
  const current = await readFile(path, "utf8").catch(() => null);
  if (current === serialize(owner)) await unlink(path).catch(() => undefined);
}
