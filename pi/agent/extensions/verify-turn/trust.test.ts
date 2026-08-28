import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveVerifier } from "./verifier.ts";

test("automatic verifiers are unavailable until the project is trusted", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-verifier-trust-"));
  const verifyDirectory = join(cwd, ".agent");
  const verifyScript = join(verifyDirectory, "verify.sh");
  mkdirSync(verifyDirectory);
  writeFileSync(verifyScript, "#!/bin/sh\nexit 0\n");
  chmodSync(verifyScript, 0o700);

  const pi = {
    exec: async () => {
      throw new Error("untrusted verifier discovery must not execute project commands");
    },
  } as unknown as ExtensionAPI;

  try {
    assert.equal(await resolveVerifier(pi, cwd, new AbortController().signal, false), undefined);
    assert.deepEqual(
      await resolveVerifier(pi, cwd, new AbortController().signal, true),
      { label: ".agent/verify.sh", command: verifyScript, args: [] },
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
