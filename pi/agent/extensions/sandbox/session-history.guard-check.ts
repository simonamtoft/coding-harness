import { mock } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  const { createSandboxGuard } = await import("./index.ts");
  const helper = "pi/agent/extensions/sandbox/session-history.ts";
  const cwd = realpathSync(resolve(import.meta.dir, "../../../.."));
  const store = join(home, ".pi/agent/sessions");
  mkdirSync(store, { recursive: true });
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
  const command = `bun ${helper} --match playwright --limit 25`;
  assert.equal(await guard({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command } }, ctx), undefined);
  const other = createSandboxGuard(join(cwd, "shared"));
  assert.equal((await other({ type: "tool_call", toolCallId: "test", toolName: "read", input: { path: store } }, ctx))?.block, true);
  assert.equal((await other({ type: "tool_call", toolCallId: "test", toolName: "bash", input: { command: `bun ${cwd}/${helper} --match playwright --limit 25` } }, ctx))?.block, true);

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
