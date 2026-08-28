import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VerifierTrustGate } from "./verifier-trust.ts";

function createVerifierProject(): { cwd: string; script: string } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-verifier-approval-"));
  const directory = join(cwd, ".agent");
  const script = join(directory, "verify.sh");
  mkdirSync(directory);
  writeFileSync(script, "#!/bin/sh\nexit 0\n");
  chmodSync(script, 0o700);
  return { cwd, script };
}

test("repository verifier approval fails closed without UI", async () => {
  const { cwd } = createVerifierProject();
  const gate = new VerifierTrustGate();
  try {
    assert.equal(await gate.requestApproval(cwd, false, async () => true), false);
    assert.equal(gate.isApproved(cwd), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("repository verifier approval is session-scoped and invalidated by changes", async () => {
  const { cwd, script } = createVerifierProject();
  const gate = new VerifierTrustGate();
  let prompts = 0;
  try {
    assert.equal(await gate.requestApproval(cwd, true, async () => {
      prompts++;
      return true;
    }), true);
    assert.equal(gate.isApproved(cwd), true);
    assert.equal(await gate.requestApproval(cwd, true, async () => {
      prompts++;
      return true;
    }), true);
    assert.equal(prompts, 1);

    writeFileSync(script, "#!/bin/sh\nexit 1\n");
    assert.equal(gate.isApproved(cwd), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
