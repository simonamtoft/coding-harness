import { mock } from "bun:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Run in a subprocess so this SDK stub and temporary HOME cannot affect other tests.
const home = process.env.PI_HISTORY_TEST_HOME;
if (!home || home !== process.env.HOME || !home.startsWith(join(tmpdir(), "pi-history-guard-"))) {
  throw new Error("run this fixture through session-history.test.ts with its isolated HOME");
}
mock.module("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => join(home, ".pi/agent"),
  isToolCallEventType: (name: string, event: { toolName: string }) => event.toolName === name,
}));
try {
  const { createSandboxGuard, default: sandboxExtension } = await import("./index.ts");
  const helper = "pi/agent/extensions/sandbox/session-history.ts";
  const cwd = realpathSync(resolve(import.meta.dir, "../../../.."));
  const store = join(home, ".pi/agent/sessions");
  mkdirSync(store, { recursive: true });
  symlinkSync(join(cwd, "pi/agent/extensions"), join(home, ".pi/agent/extensions"));
  const ctx = { hasUI: false, ui: { select: async () => undefined } };
  const guard = createSandboxGuard(cwd);
  for (const toolName of ["read", "ls", "grep", "find"] as const) {
    assert.equal(await guard({ type: "tool_call", toolCallId: "test", toolName, input: { path: store } }, ctx), undefined);
  }
  const write = await guard({ type: "tool_call", toolCallId: "test", toolName: "write", input: { path: join(store, "test.jsonl"), content: "" } }, ctx);
  assert.equal(write?.block, true);
  const secret = await guard({ type: "tool_call", toolCallId: "test", toolName: "read", input: { path: join(store, ".env") } }, ctx);
  assert.match(secret?.reason ?? "", /protected secret/);
  for (const command of [`ls ${store}`, `bun ${helper} --match playwright --limit 25 > ${store}/output`]) {
    assert.equal((await guard({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command } }, ctx))?.block, true);
  }
  for (const command of [`ls ${store}`, "ls -a; ls ~/.pi/agent/sessions; printenv | grep '^PI_'", `rg playwright ${store}`]) {
    const result = await guard({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command } }, ctx);
    assert.equal(result?.block, true);
    assert.match(result?.reason ?? "", /read tool/);
    const recoveryCommand = result?.reason?.match(/bun pi\/agent\/extensions\/sandbox\/session-history\.ts --match "[^"]+" --limit \d+/)?.[0];
    assert.ok(recoveryCommand, "session-store Bash denial must include an executable discovery command");
    assert.equal(await guard({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command: recoveryCommand } }, ctx), undefined);
  }
  const extractionArgs = "--session 01a0aaa7-b627-708e-abb1-df479a2162c1 --record 133df9ba --field message.content --offset 0 --limit 2000";
  for (const command of [`bun ${helper} ${extractionArgs}`, `bun ${helper} --match playwright --limit 25`, `bun ${helper} --audit-bulk-reads --limit 100`, `bun ${helper} --audit-bulk-reads --limit 200`]) {
    assert.equal(await guard({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command } }, ctx), undefined);
  }
  const other = createSandboxGuard(join(cwd, "shared"));
  const project = join(store, "project");
  mkdirSync(project);
  const owned = join(project, "owned.jsonl");
  const foreign = join(project, "foreign.jsonl");
  const header = (id: string, dir: string) => JSON.stringify({ type: "session", id, cwd: dir, timestamp: "2026-09-01T00:00:00Z" }) + "\n";
  writeFileSync(owned, header("owned", join(cwd, "shared")));
  writeFileSync(foreign, header("foreign", home));
  symlinkSync(owned, join(project, "linked.jsonl"));
  symlinkSync(project, join(store, "linked-project"));
  writeFileSync(join(project, "invalid.jsonl"), "not valid JSON\n");
  writeFileSync(join(project, ".env.jsonl"), header("secret", join(cwd, "shared")));
  const read = (path: string) => other({ type: "tool_call", toolCallId: "test", toolName: "read", input: { path } }, ctx);
  assert.equal(await read(owned), undefined);
  for (const path of [foreign, store, project, join(project, "linked.jsonl"),
    join(store, "linked-project", "owned.jsonl"), join(project, "invalid.jsonl"), join(project, ".env.jsonl")]) {
    assert.equal((await read(path))?.block, true, path);
  }
  assert.equal((await other({ type: "tool_call", toolCallId: "test", toolName: "write", input: { path: owned, content: "" } }, ctx))?.block, true);
  assert.equal((await other({ type: "tool_call", toolCallId: "test", toolName: "ls", input: { path: project } }, ctx))?.block, true);
  assert.equal(spawnSync("git", ["init", "-q", home]).status, 0);
  const nested = join(home, "unrelated");
  mkdirSync(nested);
  const broad = createSandboxGuard(nested);
  assert.equal((await broad({ type: "tool_call", toolCallId: "test", toolName: "read", input: { path: foreign } }, ctx))?.block, true);

  const repo = join(home, "repo");
  mkdirSync(repo);
  assert.equal(spawnSync("git", ["init", "-q", repo]).status, 0);
  const local = join(project, "local.jsonl");
  writeFileSync(local, header("local", repo));
  const nestedRepo = join(repo, "nested");
  mkdirSync(nestedRepo);
  assert.equal(spawnSync("git", ["init", "-q", nestedRepo]).status, 0);
  const nestedTranscript = join(project, "nested.jsonl");
  writeFileSync(nestedTranscript, header("nested", nestedRepo));
  const repoGuard = createSandboxGuard(repo);
  assert.equal((await repoGuard({ type: "tool_call", toolCallId: "test", toolName: "read", input: { path: nestedTranscript } }, ctx))?.block, true);
  const { registerRecentSessionsTool } = await import("./recent-sessions-tool.ts");
  type RegisteredTool = {
    name: string;
    description: string;
    parameters: { properties: { limit: { maximum: number } } };
    execute: (id: string, params: { limit?: number }) => Promise<{
      structuredContent: { sessions: Array<{ id: string }> };
      content: Array<{ text: string }>;
    }>;
  };
  let registered: RegisteredTool | undefined;
  registerRecentSessionsTool({ registerTool: (tool: RegisteredTool) => { registered = tool; } } as unknown as ExtensionAPI, repo);
  assert.equal(registered?.name, "recent_sessions");
  assert.match(registered?.description ?? "", /read tool/);
  assert.equal(registered?.parameters.properties.limit.maximum, 100);
  const tool = registered!;
  let installedTool: RegisteredTool | undefined;
  sandboxExtension({
    registerTool: (candidate: RegisteredTool) => { installedTool = candidate; },
    on: () => () => {},
  } as unknown as ExtensionAPI);
  assert.equal(installedTool?.name, "recent_sessions");
  const result = await tool.execute("test", { limit: 1 });
  assert.deepEqual(result.structuredContent.sessions.map((row: { id: string }) => row.id), ["local"]);
  assert.equal(JSON.parse(result.content[0].text).sessions[0].path, local);
  await assert.rejects(tool.execute("test", { limit: 101 }), /1–100/);
  registerRecentSessionsTool({ registerTool: (tool: RegisteredTool) => { registered = tool; } } as unknown as ExtensionAPI, nested);
  assert.equal(spawnSync("git", ["init", "-q", nested]).status, 0);
  await assert.rejects(registered!.execute("test", {}), /narrower than the home directory/);

  const recent = `bun ${cwd}/${helper} --recent --limit 25`;
  assert.equal(await other({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command: recent } }, ctx), undefined);
  assert.equal(await other({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command: "bun ~/.pi/agent/extensions/sandbox/session-history.ts --recent --limit 25" } }, ctx), undefined);
  assert.equal((await other({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command: `${recent} > output` } }, ctx))?.block, true);
  assert.equal((await other({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command: `bun ${cwd}/${helper} ${extractionArgs}` } }, ctx))?.block, true);
  assert.equal((await other({ type: "tool_call", toolCallId: "test", toolName: "read", input: { path: store } }, ctx))?.block, true);
  assert.equal((await other({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command: `bun ${cwd}/${helper} --match playwright --limit 25` } }, ctx))?.block, true);
  assert.equal((await other({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command: `bun ${cwd}/${helper} --audit-bulk-reads --limit 100` } }, ctx))?.block, true);

  for (const [scopedGuard, command] of [
    [other, `ls ${store}`],
    [guard, `ls ${store}/.env`],
    [guard, `ls ${home}/unrelated`],
  ] as const) {
    const result = await scopedGuard({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command } }, ctx);
    assert.equal(result?.block, true);
    assert.doesNotMatch(result?.reason ?? "", /--match/);
  }

  const outside = join(home, "outside");
  mkdirSync(outside);
  rmSync(store, { recursive: true });
  symlinkSync(outside, store);
  for (const scopedGuard of [guard, createSandboxGuard(cwd)]) {
    const bash = await scopedGuard({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command: `ls ${store}` } }, ctx);
    assert.equal(bash?.block, true);
    assert.doesNotMatch(bash?.reason ?? "", /--match/);
    for (const toolName of ["read", "ls", "grep", "find"] as const) {
      const result = await scopedGuard({ type: "tool_call", toolCallId: "test", toolName, input: { path: store } }, ctx);
      assert.equal(result?.block, true, `${toolName} must not trust a symlinked session-store root`);
    }
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}
