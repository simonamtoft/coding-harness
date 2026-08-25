import assert from "node:assert/strict";
import test from "node:test";
import { classifyProjectChanges, type ProjectSnapshot } from "./change-scope.ts";

function snapshot(files: Record<string, string>): ProjectSnapshot {
  return { fingerprint: "unused", files: new Map(Object.entries(files)) };
}

test("classifies unchanged snapshots", () => {
  assert.equal(
    classifyProjectChanges(snapshot({ "src/app.ts": "same" }), snapshot({ "src/app.ts": "same" })),
    "unchanged",
  );
});

test("classifies added, modified, and deleted Markdown files as Markdown-only", () => {
  assert.equal(classifyProjectChanges(snapshot({}), snapshot({ "docs/new.md": "new" })), "markdown-only");
  assert.equal(
    classifyProjectChanges(snapshot({ "README.MD": "before" }), snapshot({ "README.MD": "after" })),
    "markdown-only",
  );
  assert.equal(
    classifyProjectChanges(snapshot({ "docs/old.md": "old" }), snapshot({})),
    "markdown-only",
  );
});

test("classifies mixed and non-Markdown changes as other", () => {
  assert.equal(
    classifyProjectChanges(
      snapshot({ "docs/guide.md": "before", "src/app.ts": "before" }),
      snapshot({ "docs/guide.md": "after", "src/app.ts": "after" }),
    ),
    "other",
  );
  assert.equal(classifyProjectChanges(snapshot({}), snapshot({ "docs/page.mdx": "new" })), "other");
});

test("uses unknown when either snapshot is unavailable", () => {
  assert.equal(classifyProjectChanges(undefined, snapshot({})), "unknown");
  assert.equal(classifyProjectChanges(snapshot({}), undefined), "unknown");
});
