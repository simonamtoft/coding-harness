import { describe, expect, test } from "bun:test";

import { isStaleLock, parseLockOwner } from "./lock.ts";

const owner = { pid: 4242, host: "laptop", startedAt: "2026-09-23T00:00:00.000Z" };

describe("parseLockOwner", () => {
  test("reads a lock written by a runner", () => {
    expect(parseLockOwner(JSON.stringify(owner))).toEqual(owner);
  });

  test("rejects malformed or partial content", () => {
    expect(parseLockOwner("")).toBeNull();
    expect(parseLockOwner("{\"pid\":\"4242\",\"host\":\"laptop\",\"startedAt\":\"x\"}")).toBeNull();
    expect(parseLockOwner("[]")).toBeNull();
  });
});

describe("isStaleLock", () => {
  const alive = (pids: number[]) => ({ host: "laptop", isAlive: (pid: number) => pids.includes(pid) });

  test("keeps a lock whose local owner is still running", () => {
    expect(isStaleLock(owner, alive([4242]))).toBe(false);
  });

  test("reclaims a lock whose local owner has exited", () => {
    expect(isStaleLock(owner, alive([]))).toBe(true);
  });

  test("never presumes a lock from another host is stale", () => {
    expect(isStaleLock({ ...owner, host: "ci-runner" }, alive([]))).toBe(false);
  });

  test("reclaims an unreadable lock", () => {
    expect(isStaleLock(null, alive([4242]))).toBe(true);
  });
});
