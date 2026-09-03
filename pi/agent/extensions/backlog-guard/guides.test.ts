import assert from "node:assert/strict";
import test from "node:test";
import { createGuideLedger, repeatReadReason, requestedGuides } from "./guides.ts";

test("recognizes executed instruction reads, including combined commands", () => {
  assert.deepEqual(requestedGuides("backlog instructions overview"), ["overview"]);
  assert.deepEqual(requestedGuides("backlog instructions overview >/dev/null"), ["overview"]);
  assert.deepEqual(
    requestedGuides("backlog instructions overview && backlog instructions task-creation"),
    ["overview", "task-creation"],
  );
  assert.deepEqual(requestedGuides("backlog instructions"), ["index"]);
  assert.deepEqual(requestedGuides("backlog instructions --list"), ["index"]);
  assert.deepEqual(requestedGuides("git status --short\nbacklog instructions task-execution"), ["task-execution"]);
});

test("ignores instruction text that is written or quoted rather than executed", () => {
  assert.deepEqual(requestedGuides("echo 'backlog instructions overview'"), []);
  assert.deepEqual(requestedGuides("echo 'documentation; backlog instructions overview '"), []);
  assert.deepEqual(requestedGuides('echo "note; backlog instructions task-execution"'), []);
  assert.deepEqual(requestedGuides("rg -n 'backlog instructions task-creation' shared/skills"), []);
  assert.deepEqual(
    requestedGuides("cat > guide.md <<'EOF'\nbacklog instructions task-creation\nEOF"),
    [],
  );
  assert.deepEqual(requestedGuides("backlog task view PI-1 --plain"), []);
  assert.deepEqual(requestedGuides("backlog instructions task-invented"), []);
});

test("refuses only guides already in context, and only after they were served", () => {
  const ledger = createGuideLedger();

  assert.deepEqual(ledger.repeats("backlog instructions task-execution"), []);
  ledger.record("backlog instructions task-execution");

  assert.deepEqual(ledger.repeats("backlog instructions task-execution"), ["task-execution"]);
  assert.deepEqual(ledger.repeats("backlog instructions task-execution && git status"), ["task-execution"]);
  assert.deepEqual(ledger.repeats("backlog instructions task-finalization"), []);
  assert.deepEqual(ledger.repeats("backlog task edit PI-1 --plain"), []);
});

test("refuses a guide read twice within one command", () => {
  const ledger = createGuideLedger();

  assert.deepEqual(ledger.repeats("backlog instructions overview; backlog instructions overview"), ["overview"]);
  assert.deepEqual(ledger.repeats("backlog instructions overview && backlog instructions task-creation"), []);
});

test("reports each repeated guide once, in command order", () => {
  const ledger = createGuideLedger();
  ledger.record("backlog instructions overview && backlog instructions task-creation");

  const repeats = ledger.repeats("backlog instructions overview; backlog instructions overview; backlog instructions task-creation");

  assert.deepEqual(repeats, ["overview", "task-creation"]);
  assert.match(repeatReadReason(repeats), /`backlog instructions overview` and `backlog instructions task-creation` already ran/);
});

test("allows a re-read after compaction drops the guide from context", () => {
  const ledger = createGuideLedger();
  ledger.record("backlog instructions task-creation");
  assert.deepEqual(ledger.repeats("backlog instructions task-creation"), ["task-creation"]);

  ledger.forget();

  assert.deepEqual(ledger.repeats("backlog instructions task-creation"), []);
});
