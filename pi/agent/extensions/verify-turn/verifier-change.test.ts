import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSnapshot } from "./change-scope.ts";
import {
  acceptVerifier,
  changedPaths,
  NO_VERIFIER,
  verifierChangedSinceAccepted,
  verifierEntryPath,
} from "./verifier-change.ts";

const snapshot = (files: Record<string, string>, revision = "abc"): ProjectSnapshot => ({
  fingerprint: JSON.stringify(files),
  files: new Map(Object.entries(files)),
  revision,
});

test("the entry path is the verify script or the selected Taskfile", () => {
  assert.equal(
    verifierEntryPath({ label: ".agent/verify.sh", command: "/repo/.agent/verify.sh", args: [] }, "/repo"),
    ".agent/verify.sh",
  );
  assert.equal(
    verifierEntryPath(
      { label: "task verify", command: "task", args: ["--taskfile", "/repo/Taskfile.yaml", "verify"] },
      "/repo",
    ),
    "Taskfile.yaml",
  );
});

test("a verifier edit stays unaccepted until it is accepted, even across turns that leave it unchanged", () => {
  const original = snapshot({ ".agent/verify.sh": "v1", "src/a.ts": "a1" });
  const accepted = acceptVerifier(".agent/verify.sh", original, "v1");
  assert.equal(verifierChangedSinceAccepted(accepted, ".agent/verify.sh", original), false);

  const otherEdit = snapshot({ ".agent/verify.sh": "v1", "src/a.ts": "a2" });
  assert.equal(verifierChangedSinceAccepted(accepted, ".agent/verify.sh", otherEdit), false);

  const weakened = snapshot({ ".agent/verify.sh": "v2", "src/a.ts": "a2" });
  assert.equal(verifierChangedSinceAccepted(accepted, ".agent/verify.sh", weakened), true);
  const laterTurn = snapshot({ ".agent/verify.sh": "v2", "src/a.ts": "a3" });
  assert.equal(verifierChangedSinceAccepted(accepted, ".agent/verify.sh", laterTurn), true);

  const reaccepted = acceptVerifier(".agent/verify.sh", weakened, "v2");
  assert.equal(verifierChangedSinceAccepted(reaccepted, ".agent/verify.sh", laterTurn), false);
});

test("a verifier added to a session that started without one counts as a change", () => {
  assert.equal(verifierChangedSinceAccepted(NO_VERIFIER, ".agent/verify.sh", snapshot({ ".agent/verify.sh": "v1" })), true);
});

test("deleting the verifier or switching entry points counts as a change", () => {
  const accepted = acceptVerifier(".agent/verify.sh", snapshot({ ".agent/verify.sh": "v1" }), "v1");
  assert.equal(verifierChangedSinceAccepted(accepted, ".agent/verify.sh", snapshot({ ".agent/verify.sh": "missing" })), true);
  assert.equal(verifierChangedSinceAccepted(accepted, "Taskfile.yml", snapshot({ "Taskfile.yml": "t1" })), true);
});

test("changed paths list additions, edits, and removals within the turn", () => {
  const before = snapshot({ "a.ts": "1", "b.ts": "1", "c.ts": "1" });
  const after = snapshot({ "a.ts": "1", "b.ts": "2", "d.ts": "1" });
  assert.deepEqual(changedPaths(before, after), ["b.ts", "c.ts", "d.ts"]);
  assert.deepEqual(changedPaths(undefined, after), []);
});
