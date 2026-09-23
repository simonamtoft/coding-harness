import { expect, test } from "bun:test";

import { descendants, parseProcessTable, stillRunning } from "./processes.ts";

const at = (pid: number, ppid: number, started = "Wed Sep 23 13:25:20 2026") => ({ pid, ppid, started });

test("parseProcessTable reads pid, parent pid, and start time", () => {
  expect(parseProcessTable("    1     0 Mon Sep 21 08:00:00 2026\n  420     1 Wed Sep 23 13:25:20 2026\n\n")).toEqual([
    at(1, 0, "Mon Sep 21 08:00:00 2026"),
    at(420, 1),
  ]);
});

test("descendants follows parent links across detached groups, excluding unrelated processes", () => {
  const table = [
    at(100, 1), // pi
    at(101, 100), // bash tool shell in its own group
    at(102, 101), // command started by that shell
    at(103, 100),
    at(200, 1), // unrelated
    at(201, 200),
  ];
  expect(descendants(table, 100).map((entry) => entry.pid).sort()).toEqual([101, 102, 103]);
  expect(descendants(table, 999)).toEqual([]);
});

test("descendants tolerates self-parented and cyclic entries", () => {
  expect(descendants([at(0, 0), at(5, 6), at(6, 5)], 5).map((entry) => entry.pid)).toEqual([6]);
});

test("stillRunning drops exited processes and reused pids", () => {
  const recorded = [at(101, 100), at(102, 101), at(103, 100)];
  const current = [at(101, 1), at(103, 55, "Wed Sep 23 13:25:29 2026")];
  expect(stillRunning(recorded, current)).toEqual([at(101, 100)]);
});
