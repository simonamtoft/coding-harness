import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

import { recentNotes, saveNote } from "../src/notes.ts";
import { JsonStore } from "../src/store.ts";

test("returns an owner's most recent notes first", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-"));
  try {
    const store = new JsonStore(join(dir, "store.json"));
    saveNote(store, "ada", "1", "first", new Date("2026-01-01T00:00:00Z"));
    saveNote(store, "ada", "2", "second", new Date("2026-01-02T00:00:00Z"));
    saveNote(store, "bob", "3", "other owner", new Date("2026-01-03T00:00:00Z"));
    expect(recentNotes(store, "ada", 5).map((note) => note.body)).toEqual(["second", "first"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
