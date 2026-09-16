import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { permitsSessionHistoryCommand } from "./policy.ts";
import { parseSessionHistoryExtraction } from "./session-history-command.ts";
import { extractSessionHistoryField } from "./session-history.ts";

const session = "01a0aaa7-b627-708e-abb1-df479a2162c1";
const record = "133df9ba";
const helper = "pi/agent/extensions/sandbox/session-history.ts";
const harness = resolve(import.meta.dir, "../../../..");
const args = (field = "message.content", offset = 0, limit = 2000) => [
  "--session", session, "--record", record, "--field", field, "--offset", String(offset), "--limit", String(limit),
];

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "pi-history-extract-"));
  const root = join(home, ".pi/agent/sessions");
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  const file = join(project, `2026-09-16_${session}.jsonl`);
  const content = "Final answer 🧪\n".repeat(300);
  const records = [
    { type: "session", id: session, timestamp: "2026-09-16T00:00:00Z", cwd: "/app" },
    { type: "message", id: record, message: {
      role: "toolResult", content: [{ type: "text", text: content }], isError: false,
      details: { results: [{ model: "worker-model", messages: [
        { role: "toolResult", isError: true, content: [{ type: "text", text: "read denied" }] },
      ], large: "unrelated".repeat(40_000) }] },
    } },
  ];
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n{partial tail");
  return { home, root, project, file, content, records };
}

test("extracts and paginates selected fields from an oversized record, excluding unrelated content", async () => {
  const f = fixture();
  try {
    let offset = 0;
    let reconstructed = "";
    do {
      const page = await extractSessionHistoryField(f.root, args("message.content.0.text", offset, 333));
      assert.equal(page.totalCharacters, f.content.length);
      assert.ok(page.text.length <= 333);
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 16 * 1024);
      assert.ok(!JSON.stringify(page).includes("unrelated"));
      reconstructed += page.text;
      if (page.nextOffset === null) break;
      assert.ok(page.nextOffset > offset);
      offset = page.nextOffset;
    } while (true);
    assert.equal(reconstructed, f.content);
    const details = await extractSessionHistoryField(f.root, args("message.details.results.0.messages.0"));
    assert.deepEqual(JSON.parse(details.text), f.records[1]?.message?.details.results[0]?.messages[0]);
    assert.equal((await extractSessionHistoryField(f.root, args("message.isError"))).text, "false");
    assert.equal((await extractSessionHistoryField(f.root, args("message.content.0.text", f.content.length))).text, "");
    for (const field of ["message.missing", "message.content.9", "message.constructor", "message.__proto__", "message.isError.foo"]) {
      await assert.rejects(extractSessionHistoryField(f.root, args(field)), /field not found/);
    }
    await assert.rejects(extractSessionHistoryField(f.root, args("message.content.0.text", f.content.length + 1)), /offset/);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test("extraction grammar rejects unsafe or unbounded requests in both helper and policy", () => {
  const valid = args();
  for (const script of [helper, join(harness, helper)]) {
    const command = `bun ${script} ${valid.join(" ")}`;
    assert.equal(permitsSessionHistoryCommand(command, harness, harness), true);
    assert.equal(permitsSessionHistoryCommand(command, join(harness, "shared"), harness), false);
    for (const suffix of ["\n", "; ls", " | tee file", " > file", " --output file", " "]) {
      assert.equal(permitsSessionHistoryCommand(command + suffix, harness, harness), false);
    }
  }
  for (const [index, values] of [
    [1, ["../outside", "$(pwd)", "bad-id"]],
    [3, ["../file", "133df9ba\n"]],
    [5, ["message..content", "message[0]", "message.$HOME", "x".repeat(257)]],
    [7, ["-1", "1.5", "01", "1e3", "9007199254740992"]],
    [9, ["0", "2001", "Infinity", "2\n", "1;ls"]],
  ] as const) {
    for (const value of values) {
      const invalid = [...valid]; invalid[index] = value;
      assert.equal(parseSessionHistoryExtraction(invalid), undefined);
      assert.equal(permitsSessionHistoryCommand(`bun ${helper} ${invalid.join(" ")}`, harness, harness), false);
    }
  }
  assert.equal(parseSessionHistoryExtraction([...valid, "extra"]), undefined);
});

test("extraction refuses missing, ambiguous, mismatched, symlinked and protected sessions", async () => {
  const f = fixture();
  try {
    const missing = args(); missing[3] = "00000000";
    // The deliberately malformed tail cannot be interpreted as a record.
    await assert.rejects(extractSessionHistoryField(f.root, missing), /invalid JSON/);
    writeFileSync(f.file, f.records.map((r) => JSON.stringify(r)).join("\n"));
    await assert.rejects(extractSessionHistoryField(f.root, missing), /record not found/);
    const duplicate = join(f.project, `other_${session}.jsonl`);
    writeFileSync(duplicate, f.records.map((r) => JSON.stringify(r)).join("\n"));
    await assert.rejects(extractSessionHistoryField(f.root, args()), /ambiguous session/);
    rmSync(duplicate);
    writeFileSync(f.file, JSON.stringify({ type: "session", id: "wrong" }));
    await assert.rejects(extractSessionHistoryField(f.root, args()), /mismatch/);
    rmSync(f.file);
    const outside = join(f.home, "outside.jsonl");
    writeFileSync(outside, f.records.map((r) => JSON.stringify(r)).join("\n"));
    symlinkSync(outside, f.file);
    symlinkSync(f.root, join(f.home, "linked"));
    symlinkSync(f.home, join(f.root, "linked-project"));
    mkdirSync(join(f.root, ".env"));
    writeFileSync(join(f.root, ".env", `run_${session}.jsonl`), JSON.stringify(f.records[0]));
    await assert.rejects(extractSessionHistoryField(f.root, args()), /session not found/);
    await assert.rejects(extractSessionHistoryField(join(f.home, "linked"), args()), /symlink/);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test("CLI prints bounded extraction JSON only at the canonical root", () => {
  const f = fixture();
  try {
    const options = { encoding: "utf8" as const, timeout: 30_000, env: { ...process.env, HOME: f.home } };
    const command = [join(harness, helper), ...args("message.details.results.0.messages.0")];
    const result = spawnSync(process.execPath, command, { ...options, cwd: harness });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(JSON.parse(result.stdout).text).isError, true);
    const denied = spawnSync(process.execPath, command, { ...options, cwd: f.home });
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /canonical coding-harness root/);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});
