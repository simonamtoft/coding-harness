import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import cases from "../../../../shared/read-routing-cases.json";
import { bulkReaderFooter, createBulkReaderSession, recordBulkReaderResult } from "./coverage.ts";
import readRouting from "./index.ts";
import { bulkReadRedirect } from "./routing.ts";

const root = mkdtempSync(join(process.env.PI_SESSION_TMPDIR ?? tmpdir(), "read-routing-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

for (const [index, fixture] of cases.entries()) {
  test(fixture.name, () => {
    const cwd = join(root, String(index));
    const path = join(cwd, fixture.path);
    mkdirSync(dirname(path), { recursive: true });
    const newline = fixture.newline ?? "\n";
    const content = Array(fixture.lines).fill("x".repeat(fixture.lineWidth ?? 1)).join(newline)
      + (fixture.lines > 0 && fixture.trailingNewline !== false ? newline : "");
    writeFileSync(path, content);
    expect(Boolean(bulkReadRedirect({ ...fixture }, cwd))).toBe(fixture.route);
    expect(Boolean(bulkReadRedirect({ ...fixture, path }, root))).toBe(fixture.route);
  });
}

const aboveThreshold = `${"x".repeat(40)}\n`.repeat(1000);

test("missing files, directories, and malformed paths defer to the native tool", () => {
  expect(bulkReadRedirect({ path: "missing" }, root)).toBeUndefined();
  expect(bulkReadRedirect({ path: root }, root)).toBeUndefined();
  expect(bulkReadRedirect({ path: "bad\0path" }, root)).toBeUndefined();
  expect(bulkReadRedirect({ path: "file://remote-host/not-local" }, root)).toBeUndefined();
  expect(bulkReadRedirect({ path: 42 }, root)).toBeUndefined();
  expect(bulkReadRedirect({}, root)).toBeUndefined();
});

test("Pi @ paths and symlinks retain routing and governing-document exemptions", () => {
  const large = join(root, "large.txt");
  writeFileSync(large, aboveThreshold);
  const alias = join(root, "alias.txt");
  symlinkSync(large, alias);
  expect(bulkReadRedirect({ path: `@${alias}` }, root)).toBeDefined();
  const instructions = join(root, "AGENTS.md");
  symlinkSync(large, instructions);
  expect(bulkReadRedirect({ path: instructions }, root)).toBeUndefined();
  const instructionAlias = join(root, "instruction-alias.txt");
  const canonicalInstruction = join(root, "CONTEXT.md");
  writeFileSync(canonicalInstruction, aboveThreshold);
  symlinkSync(canonicalInstruction, instructionAlias);
  expect(bulkReadRedirect({ path: instructionAlias }, root)).toBeUndefined();
});

test("file URLs preserve routing and exemptions, including encoded names", () => {
  const path = join(root, "encoded name #.txt");
  writeFileSync(path, aboveThreshold);
  const url = pathToFileURL(path).href;
  expect(bulkReadRedirect({ path: url }, root)).toBeDefined();
  expect(bulkReadRedirect({ path: `@${url}` }, root)).toBeDefined();
  expect(bulkReadRedirect({ path: url, limit: 350 }, root)).toBeUndefined();
  const instructions = join(root, "SYSTEM.md");
  writeFileSync(instructions, aboveThreshold);
  expect(bulkReadRedirect({ path: pathToFileURL(instructions).href }, root)).toBeUndefined();
});

test("multi-byte characters are measured as bytes, not characters", () => {
  const path = join(root, "unicode.txt");
  writeFileSync(path, "é".repeat(8192));
  expect(bulkReadRedirect({ path }, root)).toBeUndefined();
  writeFileSync(path, `${"é".repeat(8192)}x`);
  expect(bulkReadRedirect({ path }, root)).toBeDefined();
});

test("Pi path aliases retain routing for large files", () => {
  const aliases = [
    ["unicode space.txt", "unicode\u00a0space.txt"],
    ["cafe\u0301.txt", "café.txt"],
    ["owner’s notes.txt", "owner's notes.txt"],
    ["report 1\u202fPM.txt", "report 1 PM.txt"],
  ];
  for (const [actualName, requestedName] of aliases) {
    const actualPath = join(root, actualName);
    writeFileSync(actualPath, aboveThreshold);
    expect(bulkReadRedirect({ path: join(root, requestedName) }, root)).toBeDefined();
  }
});

test("bounded limits include 1 and 350, but not 351 or non-finite values", () => {
  const path = join(root, "limit-boundary.txt");
  writeFileSync(path, aboveThreshold);
  for (const limit of [1, 350]) {
    expect(bulkReadRedirect({ path, limit }, root)).toBeUndefined();
  }
  for (const limit of [351, NaN, Infinity, -Infinity]) {
    expect(bulkReadRedirect({ path, limit }, root)).toBeDefined();
  }
});

type Handler = (event: Record<string, unknown>, ctx: { cwd: string }) => unknown;

function registerStub(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  readRouting({ on: (event: string, callback: Handler) => { handlers[event] = callback; } } as unknown as ExtensionAPI);
  expect(Object.keys(handlers).sort()).toEqual(["session_start", "tool_call", "tool_result"]);
  return handlers;
}

function workerRun(agent: string, readPaths: string[], status: "completed" | "failed" = "completed", deniedPaths: string[] = []) {
  const calls = [...readPaths, ...deniedPaths].map((path, index) => ({ type: "toolCall", id: `call-${index}`, name: "read", arguments: { path } }));
  const results = calls.map((call) => ({
    role: "toolResult", toolCallId: call.id, toolName: "read", isError: deniedPaths.includes(call.arguments.path),
    content: [{ type: "text", text: "..." }],
  }));
  return {
    agent,
    status,
    errorMessage: status === "failed" ? "Selected provider/model failed: 401" : undefined,
    messages: [
      { role: "user", content: [{ type: "text", text: "task" }] },
      { role: "assistant", content: calls },
      ...results,
      { role: "assistant", content: [{ type: "toolCall", id: "grep-1", name: "grep", arguments: { path: "src", pattern: "x" } }, { type: "text", text: "## Answered facts" }] },
    ],
  };
}

test("extension redirects broad reads but permits repeated bounded reads without granting permissions", () => {
  const handler = registerStub().tool_call;
  const path = join(root, "integration.txt");
  writeFileSync(path, `${"x".repeat(40)}\n`.repeat(1400));
  const blocked = handler({ toolName: "read", input: { path } }, { cwd: root });
  if (!blocked || typeof blocked !== "object" || !("block" in blocked) || !("reason" in blocked)) {
    throw new Error("Expected a routing block with handoff instructions");
  }
  expect(blocked.block).toBe(true);
  expect(blocked.reason).toContain(join(homedir(), ".pi/agent/skills/bulk-read/SKILL.md"));
  expect(blocked.reason).toContain("bulk-reader");
  expect(blocked.reason).toContain("1\u2013350 lines");
  expect(blocked.reason).toContain("one specific claim");
  expect(handler({ toolName: "read", input: { path, limit: 350 } }, { cwd: root })).toBeUndefined();
  for (const offset of [1, 351, 701, 1051]) {
    expect(handler({ toolName: "read", input: { path, offset, limit: 350 } }, { cwd: root })).toBeUndefined();
  }
  expect(handler({ toolName: "read", input: { path, offset: 1401 } }, { cwd: root })).toEqual(blocked);
  expect(handler({ toolName: "read", input: { path, limit: 351 } }, { cwd: root })).toEqual(blocked);
  expect(handler({ toolName: "bash", input: { path } }, { cwd: root })).toBeUndefined();
});

test("a successful bulk-reader result gets a coverage footer and changes later block wording", () => {
  const handlers = registerStub();
  const dir = join(root, "covered");
  mkdirSync(dir, { recursive: true });
  const covered = join(dir, "covered.ts");
  const other = join(dir, "other.ts");
  writeFileSync(covered, aboveThreshold);
  writeFileSync(other, aboveThreshold);

  const original = [{ type: "text", text: "## Answered facts" }];
  const patched = handlers.tool_result({
    toolName: "subagent",
    input: { agent: "bulk-reader", cwd: dir, task: "q" },
    content: original,
    details: { mode: "single", results: [workerRun("bulk-reader", ["covered.ts", `@${covered}`])] },
  }, { cwd: root }) as { content: { type: string; text: string }[] };
  expect(patched.content.slice(0, 1)).toEqual(original);
  const footer = patched.content[1].text;
  expect(footer).toContain("read 1 file(s): covered/covered.ts");
  expect(footer).toContain("dispatch bulk-reader again");
  expect(footer).toContain("smallest relevant section");

  const blockedCovered = handlers.tool_call({ toolName: "read", input: { path: covered } }, { cwd: root }) as { reason: string };
  expect(blockedCovered.reason).toContain("already read this file");
  const blockedOther = handlers.tool_call({ toolName: "read", input: { path: other } }, { cwd: root }) as { reason: string };
  expect(blockedOther.reason).toContain(join(homedir(), ".pi/agent/skills/bulk-read/SKILL.md"));
  expect(handlers.tool_call({ toolName: "read", input: { path: covered, offset: 1, limit: 350 } }, { cwd: root })).toBeUndefined();

  handlers.session_start({ reason: "new" }, { cwd: root });
  const afterReset = handlers.tool_call({ toolName: "read", input: { path: covered } }, { cwd: root }) as { reason: string };
  expect(afterReset.reason).not.toContain("already read this file");
});

test("denied reads and the worker's own brief are not recorded as coverage", () => {
  const session = createBulkReaderSession();
  const outcome = recordBulkReaderResult(session, { cwd: "/w" }, {
    results: [workerRun("bulk-reader", ["ok.ts", join(homedir(), ".pi/agent/skills/bulk-read/BULK-READER.md")], "completed", ["denied.ts"])],
  }, root);
  expect(outcome?.coveredFiles).toEqual(["/w/ok.ts"]);
  expect(session.coveredFiles.has("/w/denied.ts")).toBe(false);
});

test("a failed bulk-reader result steers away from redispatch until a later run succeeds", () => {
  const handlers = registerStub();
  const path = join(root, "after-failure.txt");
  writeFileSync(path, aboveThreshold);
  const failed = handlers.tool_result({
    toolName: "subagent",
    input: { agent: "bulk-reader", cwd: root },
    content: [{ type: "text", text: "Agent error" }],
    details: { mode: "single", results: [workerRun("bulk-reader", [], "failed")] },
  }, { cwd: root }) as { content: { text: string }[] };
  expect(failed.content[1].text).toContain("bulk-reader failed (Selected provider/model failed: 401)");
  expect(failed.content[1].text).toContain("Do not redispatch");

  const blocked = handlers.tool_call({ toolName: "read", input: { path } }, { cwd: root }) as { reason: string };
  expect(blocked.reason).toContain("failed earlier in this session");
  expect(blocked.reason).not.toContain("SKILL.md");

  handlers.tool_result({
    toolName: "subagent",
    input: { agent: "bulk-reader", cwd: root },
    content: [],
    details: { mode: "single", results: [workerRun("bulk-reader", ["unrelated.txt"])] },
  }, { cwd: root });
  const recovered = handlers.tool_call({ toolName: "read", input: { path } }, { cwd: root }) as { reason: string };
  expect(recovered.reason).toContain("SKILL.md");
});

test("results without a bulk-reader run and non-subagent tools are left untouched", () => {
  const handlers = registerStub();
  expect(handlers.tool_result({
    toolName: "subagent",
    input: { agent: "correctness-reviewer" },
    content: [],
    details: { mode: "single", results: [workerRun("correctness-reviewer", ["a.ts"])] },
  }, { cwd: root })).toBeUndefined();
  expect(handlers.tool_result({ toolName: "read", input: {}, content: [], details: {} }, { cwd: root })).toBeUndefined();
});

test("parallel dispatches resolve worker reads against each task cwd", () => {
  const session = createBulkReaderSession();
  const outcome = recordBulkReaderResult(session, {
    tasks: [{ agent: "bulk-reader", cwd: "/a" }, { agent: "bulk-reader", cwd: "/b" }],
  }, {
    results: [workerRun("bulk-reader", ["x.ts"]), workerRun("bulk-reader", ["y.ts"], "failed")],
  }, root);
  expect(outcome).toEqual({ coveredFiles: ["/a/x.ts"], succeeded: true, errorMessage: "Selected provider/model failed: 401" });
  expect(session.workerFailed).toBe(false);
  expect(bulkReaderFooter(outcome!, root)).toContain("/a/x.ts");
  expect(bulkReaderFooter({ coveredFiles: [], succeeded: true }, root)).toBeUndefined();
});
