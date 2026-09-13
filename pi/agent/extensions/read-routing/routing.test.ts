import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import cases from "../../../../shared/read-routing-cases.json";
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

test("extension redirects broad reads but permits repeated bounded reads without granting permissions", () => {
  // The extension only registers tool_call; the stub captures that public boundary.
  let handler: (event: { toolName: string; input: { path: string; offset?: number; limit?: number } }, ctx: { cwd: string }) => unknown;
  readRouting({ on: (event: string, callback: typeof handler) => {
    expect(event).toBe("tool_call");
    handler = callback;
  } } as ExtensionAPI);
  const path = join(root, "integration.txt");
  writeFileSync(path, `${"x".repeat(40)}\n`.repeat(1400));
  const blocked = handler!({ toolName: "read", input: { path } }, { cwd: root });
  if (!blocked || typeof blocked !== "object" || !("block" in blocked) || !("reason" in blocked)) {
    throw new Error("Expected a routing block with handoff instructions");
  }
  expect(blocked.block).toBe(true);
  expect(blocked.reason).toContain(join(homedir(), ".pi/agent/skills/bulk-read/SKILL.md"));
  expect(blocked.reason).toContain("bulk-reader");
  expect(blocked.reason).toContain("1\u2013350 lines");
  expect(handler!({ toolName: "read", input: { path, limit: 350 } }, { cwd: root })).toBeUndefined();
  for (const offset of [1, 351, 701, 1051]) {
    expect(handler!({ toolName: "read", input: { path, offset, limit: 350 } }, { cwd: root })).toBeUndefined();
  }
  expect(handler!({ toolName: "read", input: { path, offset: 1401 } }, { cwd: root })).toEqual(blocked);
  expect(handler!({ toolName: "read", input: { path, limit: 351 } }, { cwd: root })).toEqual(blocked);
  expect(handler!({ toolName: "bash", input: { path } }, { cwd: root })).toBeUndefined();
});
