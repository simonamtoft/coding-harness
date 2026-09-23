import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LockOwner } from "../lib/lock.ts";
import { acquireLock, reclaimStaleLock, releaseLock } from "../record-lock.ts";

const owner = (pid: number, host = "laptop"): LockOwner => ({ pid, host, startedAt: `start-${pid}` });
const serialized = (lockOwner: LockOwner) => `${JSON.stringify(lockOwner)}\n`;
const aliveOnly = (...pids: number[]) => (pid: number) => pids.includes(pid);

let dir: string;
let lock: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "record-lock-test-"));
  lock = join(dir, "record.json.lock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("the first runner acquires and a second sees it as the live holder", async () => {
  expect(await acquireLock(lock, owner(1), aliveOnly(1, 2))).toBeNull();
  expect(await acquireLock(lock, owner(2), aliveOnly(1, 2))).toEqual(owner(1));
  expect(readdirSync(dir)).toEqual(["record.json.lock"]);
});

test("a lock whose local owner is dead is reclaimed", async () => {
  writeFileSync(lock, serialized(owner(1)));
  expect(await acquireLock(lock, owner(2), aliveOnly(2))).toBeNull();
  expect(readFileSync(lock, "utf8")).toBe(serialized(owner(2)));
});

test("a lock held on another host is never reclaimed", async () => {
  writeFileSync(lock, serialized(owner(1, "ci-runner")));
  expect(await acquireLock(lock, owner(2), aliveOnly(2))).toEqual(owner(1, "ci-runner"));
});

test("a runner that inspected a stale lock does not delete the fresh lock another runner took meanwhile", async () => {
  const staleText = serialized(owner(1));
  writeFileSync(lock, staleText);
  // Runner 2 read the stale lock; before it reclaims, runner 3 reclaims and acquires.
  expect(await acquireLock(lock, owner(3), aliveOnly(2, 3))).toBeNull();
  expect(await reclaimStaleLock(lock, staleText, owner(2), aliveOnly(2, 3))).toBe(true);
  expect(readFileSync(lock, "utf8")).toBe(serialized(owner(3)));
  expect(await acquireLock(lock, owner(2), aliveOnly(2, 3))).toEqual(owner(3));
  expect(readdirSync(dir)).toEqual(["record.json.lock"]);
});

test("the live lock never leaves its path, so a third runner cannot slip in during reclamation", async () => {
  const staleText = serialized(owner(1));
  writeFileSync(lock, staleText);
  expect(await acquireLock(lock, owner(3), aliveOnly(2, 3, 4))).toBeNull();
  // Runner 2 acts on its old stale observation while runner 4 tries to acquire.
  const [reclaimed, fourth] = await Promise.all([
    reclaimStaleLock(lock, staleText, owner(2), aliveOnly(2, 3, 4)),
    acquireLock(lock, owner(4), aliveOnly(2, 3, 4)),
  ]);
  expect(typeof reclaimed).toBe("boolean");
  expect(fourth).toEqual(owner(3));
  expect(readFileSync(lock, "utf8")).toBe(serialized(owner(3)));
});

test("a reclaimer yields while another reclaimer holds the mutex", async () => {
  const staleText = serialized(owner(1));
  writeFileSync(lock, staleText);
  writeFileSync(`${lock}.reclaim.lock`, serialized(owner(3)));
  expect(await reclaimStaleLock(lock, staleText, owner(2), aliveOnly(2, 3))).toBe(false);
  expect(readFileSync(lock, "utf8")).toBe(staleText);
  expect(existsSync(`${lock}.reclaim.lock`)).toBe(true);
});

test("a mutex left by a dead reclaimer is cleared so reclamation can proceed", async () => {
  writeFileSync(lock, serialized(owner(1)));
  writeFileSync(`${lock}.reclaim.lock`, serialized(owner(3)));
  expect(await acquireLock(lock, owner(2), aliveOnly(2))).toBeNull();
  expect(readdirSync(dir)).toEqual(["record.json.lock"]);
});

test("release deletes only the releasing runner's own lock", async () => {
  expect(await acquireLock(lock, owner(1), aliveOnly(1))).toBeNull();
  await releaseLock(lock, owner(2));
  expect(existsSync(lock)).toBe(true);
  await releaseLock(lock, owner(1));
  expect(existsSync(lock)).toBe(false);
});
