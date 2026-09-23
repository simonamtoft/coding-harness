import type { JsonStore, Note } from "./store.ts";

export function saveNote(store: JsonStore, ownerId: string, id: string, body: string, now: Date): Note {
  const note = { id, ownerId, body, updatedAt: now.toISOString() };
  store.upsert(note);
  return note;
}

export function recentNotes(store: JsonStore, ownerId: string, limit: number): Note[] {
  return store
    .notesFor(ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
