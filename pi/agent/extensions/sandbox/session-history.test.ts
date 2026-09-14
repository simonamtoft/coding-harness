import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hasSessionHistoryReadAccess, permitsSessionHistoryCommand } from "./policy.ts";
import { findSessionHistory, isSafeSessionHistoryTree } from "./session-history.ts";

const harness = "/Users/example/coding-harness";
const history = "/Users/example/.pi/agent/sessions";
const helper = "pi/agent/extensions/sandbox/session-history.ts";

test("history reads require the exact harness root and never grant writes or sibling access", () => {
  for (const tool of ["read", "grep", "find", "ls"]) {
    assert.equal(hasSessionHistoryReadAccess(tool, harness, `${history}/project/run.jsonl`, harness, history), true);
    for (const cwd of [`${harness}/shared`, `${harness}-other`, "/Users/example/app", "/Users/example/pi-plugins"]) {
      assert.equal(hasSessionHistoryReadAccess(tool, cwd, history, harness, history), false);
    }
    for (const target of [`${history}-other/run.jsonl`, `${history}/../auth.json`, `${history}/.env/run.jsonl`]) {
      assert.equal(hasSessionHistoryReadAccess(tool, harness, target, harness, history), false);
    }
  }
  for (const tool of ["write", "edit", "bash", "subagent"]) {
    assert.equal(hasSessionHistoryReadAccess(tool, harness, history, harness, history), false);
  }
});

test("the tool-call guard grants reads, denies writes and arbitrary Bash, and keeps other projects gated", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-history-guard-"));
  try {
    const result = spawnSync(process.execPath, [join(import.meta.dir, "session-history.guard-check.ts")], {
      encoding: "utf8", timeout: 30_000, env: { ...process.env, HOME: home, PI_HISTORY_TEST_HOME: home },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("only the literal bounded discovery command is granted", () => {
  for (const script of [helper, `${harness}/${helper}`]) {
    const command = `bun ${script} --match "playwright" --limit 25`;
    assert.equal(permitsSessionHistoryCommand(command, harness, harness), true);
    assert.equal(permitsSessionHistoryCommand(command, `${harness}/shared`, harness), false);
    for (const suffix of ["; rm file", " && ls", " | tee file", " > file", "\nls", " --output file", " "]) {
      assert.equal(permitsSessionHistoryCommand(command + suffix, harness, harness), false);
    }
  }
  for (const query of ['"$(touch file)"', '"`touch file`"', '"$HOME"', "../.env", "*", '"a\\nb"']) {
    assert.equal(permitsSessionHistoryCommand(`bun ${helper} --match ${query} --limit 25`, harness, harness), false);
  }
  for (const limit of ["0", "101", "-1", "1.5"]) {
    assert.equal(permitsSessionHistoryCommand(`bun ${helper} --match playwright --limit ${limit}`, harness, harness), false);
  }
  for (const command of [`ls ${history}`, `rm ${history}/run.jsonl`, `bun other.ts --match playwright --limit 25`]) {
    assert.equal(permitsSessionHistoryCommand(command, harness, harness), false);
  }
});

test("discovery finds the newest matching top-level transcripts, including tool calls and results", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-history-test-"));
  const store = join(root, "sessions");
  const project = join(store, "project");
  mkdirSync(project, { recursive: true });
  const transcript = (id: string, day: number, message: unknown) => [
    JSON.stringify({ type: "session", id, timestamp: `2026-09-${day}T10:00:00Z`, cwd: "/app" }),
    "malformed tail",
    JSON.stringify({ type: "message", message }),
  ].join("\n");
  writeFileSync(join(project, "old.jsonl"), transcript("old", 10, { role: "user", content: "Playwright" }));
  writeFileSync(join(project, "new.jsonl"), transcript("new", 12, { role: "assistant", content: [{ type: "toolCall", arguments: { command: "bun playwright test" } }] }));
  writeFileSync(join(project, "middle.jsonl"), transcript("middle", 11, { role: "toolResult", content: [{ text: "playwright timeout" }] }));
  writeFileSync(join(project, "unrelated.jsonl"), transcript("unrelated", 13, { content: "other" }));
  mkdirSync(join(project, "subagents"));
  writeFileSync(join(project, "subagents", "child.jsonl"), transcript("child", 14, { content: "playwright" }));
  writeFileSync(join(root, "outside.jsonl"), transcript("outside", 15, { content: "playwright" }));
  symlinkSync(join(root, "outside.jsonl"), join(project, "escape.jsonl"));
  mkdirSync(join(project, ".env"));
  writeFileSync(join(project, ".env", "secret.jsonl"), transcript("secret", 16, { content: "playwright" }));
  try {
    assert.deepEqual((await findSessionHistory(store, "PLAYWRIGHT", 2)).map((s) => s.id), ["new", "middle"]);
    assert.deepEqual(await findSessionHistory(store, "no-match", 25), []);
    assert.equal(isSafeSessionHistoryTree(store), false);
    assert.equal(isSafeSessionHistoryTree(join(project, "new.jsonl")), true);
    assert.equal(isSafeSessionHistoryTree(join(project, ".env")), false);
    assert.equal(isSafeSessionHistoryTree(join(project, "escape.jsonl")), false);
    assert.equal(isSafeSessionHistoryTree(join(root, "missing")), false);
    symlinkSync(store, join(root, "linked-store"));
    await assert.rejects(findSessionHistory(join(root, "linked-store"), "playwright", 25), /symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
