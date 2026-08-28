import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hardenPiPermissions } from "./permissions.ts";

function mode(path: string): number {
  return lstatSync(path).mode & 0o777;
}

test("Pi configuration and retained sessions become owner-only", () => {
  const agentDirectory = mkdtempSync(join(tmpdir(), "pi-permissions-"));
  const nestedSessionDirectory = join(agentDirectory, "sessions", "project");
  const sessionFile = join(nestedSessionDirectory, "session.jsonl");
  const settingsFile = join(agentDirectory, "settings.json");
  mkdirSync(nestedSessionDirectory, { recursive: true, mode: 0o755 });
  writeFileSync(sessionFile, "{}\n", { mode: 0o644 });
  writeFileSync(settingsFile, "{}\n", { mode: 0o644 });

  try {
    hardenPiPermissions(agentDirectory);

    assert.equal(mode(agentDirectory), 0o700);
    assert.equal(mode(join(agentDirectory, "sessions")), 0o700);
    assert.equal(mode(nestedSessionDirectory), 0o700);
    assert.equal(mode(sessionFile), 0o600);
    assert.equal(mode(settingsFile), 0o600);
  } finally {
    rmSync(agentDirectory, { recursive: true, force: true });
  }
});
