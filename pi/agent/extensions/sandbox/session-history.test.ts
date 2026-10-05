import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { hasSessionHistoryReadAccess, permitsSessionHistoryCommand } from "./policy.ts";
import { auditRecentBulkReads, findSessionHistory, isSafeSessionHistoryTree, listRecentSessionHistory } from "./session-history.ts";

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

test("the tool-call guard grants reads, denies writes and arbitrary Bash, and keeps other projects gated", { timeout: 15_000 }, () => {
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

test("only the literal bounded discovery and audit commands are granted", () => {
  const recent = `bun ${harness}/${helper} --recent --limit 25`;
  for (const cwd of [harness, `${harness}/shared`, "/Users/example/app"]) {
    assert.equal(permitsSessionHistoryCommand(recent, cwd, harness), true);
    assert.equal(permitsSessionHistoryCommand("bun ~/.pi/agent/extensions/sandbox/session-history.ts --recent --limit 25", cwd, harness), true);
    assert.equal(permitsSessionHistoryCommand(`bun ${helper} --recent --limit 25`, cwd, harness), false);
  }
  for (const suffix of ["; ls", " | tee file", " > file", " --output file", " ", "\nls"]) {
    assert.equal(permitsSessionHistoryCommand(recent + suffix, "/Users/example/app", harness), false);
  }
  for (const limit of ["0", "101", "-1", "1.5", "01"]) {
    assert.equal(permitsSessionHistoryCommand(`bun ${harness}/${helper} --recent --limit ${limit}`, "/Users/example/app", harness), false);
  }
  for (const script of [helper, `${harness}/${helper}`]) {
    const audit = `bun ${script} --audit-bulk-reads --limit 100`;
    assert.equal(permitsSessionHistoryCommand(audit, harness, harness), true);
    assert.equal(permitsSessionHistoryCommand(`bun ${script} --audit-bulk-reads --limit 200`, harness, harness), true);
    assert.equal(permitsSessionHistoryCommand(`bun ${script} --audit-bulk-reads --limit 201`, harness, harness), false);
    assert.equal(permitsSessionHistoryCommand(audit, `${harness}/shared`, harness), false);
    for (const suffix of ["; ls", " | tee file", " > file", " --output file", " "]) {
      assert.equal(permitsSessionHistoryCommand(audit + suffix, harness, harness), false);
    }
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

test("recent listing is scoped to the current repository and reads only session headers", async () => {
  const home = mkdtempSync(join(tmpdir(), "pi-history-recent-"));
  const repo = join(home, "repo");
  const other = join(home, "other");
  const store = join(home, ".pi/agent/sessions");
  const project = join(store, "project");
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(other);
  mkdirSync(project, { recursive: true });
  const session = (id: string, day: number, cwd: string) =>
    `${JSON.stringify({ type: "session", id, timestamp: `2026-09-${day}T10:00:00Z`, cwd })}\nnot valid JSON\n`;
  writeFileSync(join(project, "older.jsonl"), session("older", 10, repo));
  writeFileSync(join(project, "newer.jsonl"), session("newer", 12, join(repo, "src")));
  const nested = join(repo, "nested");
  mkdirSync(nested);
  assert.equal(spawnSync("git", ["init", "-q", nested]).status, 0);
  writeFileSync(join(project, "nested.jsonl"), session("nested", 13, nested));
  writeFileSync(join(project, "foreign.jsonl"), session("foreign", 14, other));
  writeFileSync(join(project, "sibling.jsonl"), session("sibling", 15, `${repo}-other`));
  writeFileSync(join(project, "invalid.jsonl"), '{"type":"session","id":"invalid","timestamp":"n/a","cwd":"' + repo + '"}\n');
  symlinkSync(join(project, "foreign.jsonl"), join(project, "linked.jsonl"));
  mkdirSync(join(store, ".env"));
  writeFileSync(join(store, ".env", "secret.jsonl"), session("secret", 16, repo));
  assert.equal(spawnSync("git", ["init", "-q", repo]).status, 0);
  try {
    assert.deepEqual((await listRecentSessionHistory(store, repo, 1)).map((row) => row.id), ["newer"]);
    assert.deepEqual((await listRecentSessionHistory(store, repo, 100)).map((row) => row.id), ["newer", "older"]);
    await assert.rejects(listRecentSessionHistory(store, repo, 0), /1–100/);
    const result = spawnSync(process.execPath, [join(import.meta.dir, "session-history.ts"), "--recent", "--limit", "2"], {
      cwd: join(repo, "src"), env: { ...process.env, HOME: home }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n").map((line) => JSON.parse(line).id), ["newer", "older"]);
    assert.equal(spawnSync("git", ["init", "-q", home]).status, 0);
    const broad = spawnSync(process.execPath, [join(import.meta.dir, "session-history.ts"), "--recent", "--limit", "2"], {
      cwd: home, env: { ...process.env, HOME: home }, encoding: "utf8",
    });
    assert.equal(broad.status, 1);
    assert.match(broad.stderr, /narrower than the home directory/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("audit selects recent top-level sessions without matching injected instruction text", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-history-audit-"));
  const store = join(root, "sessions");
  const project = join(store, "project");
  mkdirSync(project, { recursive: true });
  const record = (id: string, day: number, messages: unknown[]) => [
    { type: "session", id, timestamp: `2026-09-${day}T10:00:00Z`, cwd: "/app" },
    { type: "message", message: { role: "system", content: "bulk-reader bulk-read" } },
    ...messages.map((message) => ({ type: "message", message })),
  ].map((value) => JSON.stringify(value)).join("\n");
  writeFileSync(join(project, "older.jsonl"), record("older", 10, [
    { role: "assistant", content: [{ type: "toolCall", id: "r", name: "read", arguments: { path: "/app/docs.md" } }] },
    { role: "toolResult", toolCallId: "r", toolName: "read", content: [{ type: "text", text: "Bulk read routed. Read skill" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "s", name: "subagent", arguments: { agent: "bulk-reader" } }] },
    { role: "toolResult", toolCallId: "s", toolName: "subagent", content: [{ type: "text", text: "sourced findings" }], details: { results: [{ agent: "bulk-reader", exitCode: 0, usage: { cost: 0.008 }, messages: [
      { role: "assistant", usage: { cost: { total: 0.008 } }, content: [{ type: "toolCall", id: "child", name: "read", arguments: { path: "/app/docs.md" } }] },
      { role: "toolResult", toolCallId: "child", toolName: "read", content: [{ type: "text", text: "source" }] },
    ] }] } },
    { role: "assistant", content: [{ type: "toolCall", id: "r2", name: "read", arguments: { path: "/app/docs.md" } }] },
    { role: "toolResult", toolCallId: "r2", toolName: "read", content: [{ type: "text", text: "source" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "r3", name: "read", arguments: { path: "/app/other.ts" } }] },
    { role: "user", content: [{ type: "text", text: "One more question" }] },
  ]));
  writeFileSync(join(project, "newer.jsonl"), record("newer", 12, [
    { role: "user", content: "Review PI-62 bulk-read" },
    { role: "assistant", content: [{ type: "toolCall", id: "x", name: "subagent", arguments: { chain: [{ agent: "bulk-reader" }] } }] },
    { role: "toolResult", toolCallId: "x", toolName: "subagent", details: { results: [{ agent: "bulk-reader", exitCode: 0, stopReason: "error", status: "failed" }] } },
  ]));
  writeFileSync(join(project, "newest.jsonl"), record("newest", 13, []));
  symlinkSync(join(project, "older.jsonl"), join(project, "linked.jsonl"));
  mkdirSync(join(store, ".env"));
  writeFileSync(join(store, ".env", "secret.jsonl"), record("secret", 14, []));
  try {
    assert.deepEqual(await auditRecentBulkReads(store, 3), [
      { id: "newest", timestamp: "2026-09-13T10:00:00Z", cwd: "/app", topicPrompt: false, parentReadCalls: 0, redirects: 0, dispatches: 0, successes: 0, failures: 0, laterParentReads: 0, coveredParentReads: 0, coveredParentReadBytes: 0, workerCost: 0, unreportedWorkerCosts: 0, estimates: [] },
      { id: "newer", timestamp: "2026-09-12T10:00:00Z", cwd: "/app", topicPrompt: true, parentReadCalls: 0, redirects: 0, dispatches: 1, successes: 0, failures: 1, laterParentReads: 0, coveredParentReads: 0, coveredParentReadBytes: 0, workerCost: 0, unreportedWorkerCosts: 1, estimates: [] },
      { id: "older", timestamp: "2026-09-10T10:00:00Z", cwd: "/app", topicPrompt: false, parentReadCalls: 3, redirects: 1, dispatches: 1, successes: 1, failures: 0, laterParentReads: 2, coveredParentReads: 1, coveredParentReadBytes: 6, workerCost: 0.008, unreportedWorkerCosts: 0, estimates: [] },
    ]);
    assert.deepEqual((await auditRecentBulkReads(store, 2)).map((session) => session.id), ["newest", "newer"]);
    assert.deepEqual((await auditRecentBulkReads(store, 200)).map((session) => session.id), ["newest", "newer", "older"]);
    await assert.rejects(auditRecentBulkReads(store, 201), /1–200/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("audit estimates a single worker's source-read replacement at the parent's reported rates", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-history-cost-"));
  const project = join(root, "project");
  mkdirSync(project);
  const args = { agent: "bulk-reader", cwd: "docs", task: "Find value" };
  const writeTranscript = (reportedCost: number | undefined) => {
    const messages = [
      { role: "assistant", provider: "anthropic", model: "parent", usage: {
        input: 100, output: 100, cost: { input: 0.0005, output: 0.0025 },
      }, content: [{ type: "toolCall", id: "s", name: "subagent", arguments: args }] },
      { role: "toolResult", toolName: "subagent", toolCallId: "s", content: [{ type: "text", text: "answer" }], details: { results: [
        { agent: "bulk-reader", exitCode: 0, usage: { cost: reportedCost ?? 0 }, messages: [
          { role: "assistant", ...(reportedCost === undefined ? {} : { usage: { cost: { total: reportedCost } } }), content: [
            { type: "toolCall", id: "brief", name: "read", arguments: { path: "/app/bulk-read/BULK-READER.md" } },
            { type: "toolCall", id: "source", name: "read", arguments: { path: "source.md" } },
          ] },
          { role: "toolResult", toolName: "read", toolCallId: "brief", content: [{ type: "text", text: "z".repeat(360) }] },
          { role: "toolResult", toolName: "read", toolCallId: "source", content: [{ type: "text", text: "x".repeat(360) }] },
        ] },
      ] } },
      { role: "assistant", content: [{ type: "toolCall", id: "parent-source", name: "read", arguments: { path: "docs/source.md" } }] },
      { role: "toolResult", toolName: "read", toolCallId: "parent-source", content: [{ type: "text", text: "source" }] },
    ];
    writeFileSync(join(project, "run.jsonl"), [
      { type: "session", id: "run", timestamp: "2026-09-20T10:00:00Z", cwd: "/app" },
      ...messages.map((message) => ({ type: "message", message })),
    ].map((value) => JSON.stringify(value)).join("\n"));
  };
  writeTranscript(0.001);
  try {
    const [row] = await auditRecentBulkReads(root, 200);
    assert.deepEqual(row?.estimates, [{
      direct: 0.0005,
      delegated: 0.001 + 6 / 3.6 * 0.000005 + JSON.stringify(args).length / 3.6 * 0.000025,
      readTokens: 100, worker: 0.001,
    }]);
    assert.equal(row?.unreportedWorkerCosts, 0);
    assert.equal(row?.coveredParentReads, 1);

    writeTranscript(undefined);
    const [unreported] = await auditRecentBulkReads(root, 200);
    assert.equal(unreported?.unreportedWorkerCosts, 1);
    assert.equal(unreported?.workerCost, 0);
    assert.deepEqual(unreported?.estimates, []);

    writeTranscript(0);
    const [reportedZero] = await auditRecentBulkReads(root, 200);
    assert.equal(reportedZero?.unreportedWorkerCosts, 0);
    assert.equal(reportedZero?.estimates.length, 1);
    assert.equal(reportedZero?.estimates[0]?.worker, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("audit CLI reports the midpoint median for two measured runs", async () => {
  const home = mkdtempSync(join(tmpdir(), "pi-history-median-"));
  const store = join(home, ".pi/agent/sessions");
  const project = join(store, "project");
  mkdirSync(project, { recursive: true });
  const messages: unknown[] = [];
  for (const [index, cost] of [0.0001, 0.0005].entries()) {
    const id = `s${index}`;
    messages.push(
      { role: "assistant", provider: "anthropic", model: "parent", usage: {
        input: 100, output: 100, cost: { input: 0.001, output: 0.002 },
      }, content: [{ type: "toolCall", id, name: "subagent", arguments: { agent: "bulk-reader" } }] },
      { role: "toolResult", toolName: "subagent", toolCallId: id, content: [{ type: "text", text: "answer" }], details: { results: [
        { agent: "bulk-reader", exitCode: 0, usage: { cost }, messages: [
          { role: "assistant", usage: { cost: { total: cost } }, content: [
            { type: "toolCall", id: `r${index}`, name: "read", arguments: { path: "data.txt" } },
          ] },
          { role: "toolResult", toolName: "read", toolCallId: `r${index}`, content: [{ type: "text", text: "x".repeat(360) }] },
        ] },
      ] } },
    );
  }
  writeFileSync(join(project, "run.jsonl"), [
    { type: "session", id: "run", timestamp: "2026-09-20T10:00:00Z", cwd: "/app" },
    ...messages.map((message) => ({ type: "message", message })),
  ].map((value) => JSON.stringify(value)).join("\n"));
  try {
    const result = spawnSync(process.execPath, [join(import.meta.dir, "session-history.ts"), "--audit-bulk-reads", "--limit", "2"], {
      cwd: resolve(import.meta.dir, "../../../.."), encoding: "utf8", timeout: 30_000, env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 0, result.stderr);
    const [summary, row] = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(row.estimates.length, 2);
    const [a, b] = row.estimates.map((run: { direct: number; delegated: number }) =>
      (run.direct - run.delegated) / run.direct);
    assert.notEqual(a, b);
    assert.equal(summary.estimatedRuns, 2);
    assert.equal(summary.unreportedWorkerCosts, 0);
    assert.equal(summary.medianRunSavingRatio, (a + b) / 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("audit matches each parallel worker's own cwd and ignores failed reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-history-parallel-"));
  const project = join(root, "project");
  mkdirSync(project);
  const messages = [
    { role: "assistant", content: [{ type: "toolCall", id: "p", name: "subagent", arguments: { tasks: [
      { agent: "other", cwd: "/wrong" }, { agent: "bulk-reader", cwd: "docs" },
    ] } }] },
    { role: "toolResult", toolName: "subagent", toolCallId: "p", details: { results: [
      { agent: "other", exitCode: 0 },
      { agent: "bulk-reader", exitCode: 0, usage: { cost: 0.004 }, messages: [
        { role: "assistant", usage: { cost: { total: 0.004 } }, content: [
          { type: "toolCall", name: "read", id: "ok", arguments: { path: "@source.md" } },
          { type: "toolCall", name: "read", id: "bad", arguments: { path: "missing.md" } },
        ] },
        { role: "toolResult", toolName: "read", toolCallId: "ok", isError: false },
        { role: "toolResult", toolName: "read", toolCallId: "bad", isError: true },
      ] },
    ] } },
    { role: "assistant", content: [
      { type: "toolCall", name: "read", id: "r1", arguments: { path: "docs/source.md" } },
      { type: "toolCall", name: "read", id: "r2", arguments: { path: "docs/missing.md" } },
      { type: "toolCall", name: "read", id: "r3", arguments: { path: "@docs/source.md" } },
    ] },
    { role: "toolResult", toolName: "read", toolCallId: "r1", content: [{ type: "text", text: "answer" }] },
    { role: "toolResult", toolName: "read", toolCallId: "r2", isError: true, content: [{ type: "text", text: "error" }] },
    { role: "toolResult", toolName: "read", toolCallId: "r3", content: [{ type: "text", text: "answer" }] },
  ];
  writeFileSync(join(project, "run.jsonl"), [
    { type: "session", id: "run", timestamp: "2026-09-20T10:00:00Z", cwd: "/app" },
    ...messages.map((message) => ({ type: "message", message })),
  ].map((value) => JSON.stringify(value)).join("\n"));
  try {
    const [row] = await auditRecentBulkReads(root, 200);
    assert.equal(row?.coveredParentReads, 2);
    assert.equal(row?.coveredParentReadBytes, 12);
    assert.equal(row?.workerCost, 0.004);
  } finally {
    rmSync(root, { recursive: true, force: true });
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
