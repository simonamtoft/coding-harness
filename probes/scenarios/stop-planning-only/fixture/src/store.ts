import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type Note = { id: string; ownerId: string; body: string; updatedAt: string };

type Data = { notes: Note[] };

/** Whole-file JSON persistence: every write rewrites the file. */
export class JsonStore {
  constructor(private readonly path: string) {}

  private load(): Data {
    return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as Data) : { notes: [] };
  }

  private save(data: Data): void {
    writeFileSync(this.path, JSON.stringify(data, null, 2));
  }

  notesFor(ownerId: string): Note[] {
    return this.load().notes.filter((note) => note.ownerId === ownerId);
  }

  upsert(note: Note): void {
    const data = this.load();
    const index = data.notes.findIndex((existing) => existing.id === note.id);
    if (index === -1) data.notes.push(note);
    else data.notes[index] = note;
    this.save(data);
  }
}
