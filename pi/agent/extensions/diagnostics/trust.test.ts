import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DiagnosticsTrustGate } from "./trust.ts";

function createDiagnosticsProject(): { cwd: string; script: string } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-diagnostics-approval-"));
  const directory = join(cwd, ".agent");
  const script = join(directory, "diagnostics.sh");
  mkdirSync(directory);
  writeFileSync(script, "#!/bin/sh\nexit 0\n");
  chmodSync(script, 0o700);
  return { cwd, script };
}

test("diagnostics approval fails closed without UI", async () => {
  const { cwd } = createDiagnosticsProject();
  const gate = new DiagnosticsTrustGate();
  try {
    assert.equal(await gate.requestApproval(cwd, false, async () => true), false);
    assert.equal(gate.isApproved(cwd), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("diagnostics approval is session-scoped and invalidated by script changes", async () => {
  const { cwd, script } = createDiagnosticsProject();
  const gate = new DiagnosticsTrustGate();
  let prompts = 0;
  try {
    assert.equal(await gate.requestApproval(cwd, true, async () => {
      prompts++;
      return true;
    }), true);
    assert.equal(gate.isApproved(cwd), true);

    writeFileSync(script, "#!/bin/sh\nexit 1\n");
    assert.equal(gate.isApproved(cwd), false);
    assert.equal(prompts, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
