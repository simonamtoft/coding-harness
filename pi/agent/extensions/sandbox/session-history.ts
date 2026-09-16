import { createReadStream, lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isProtectedSecretPath } from "./policy.ts";
import { parseSessionHistoryExtraction } from "./session-history-command.ts";

export function sessionHistoryRoot(): string {
  return join(homedir(), ".pi", "agent", "sessions");
}

function isSafeEntry(path: string): boolean {
  return !isProtectedSecretPath(path) && !lstatSync(path).isSymbolicLink();
}

export function isSessionHistoryDirectory(path: string): boolean {
  try {
    return isSafeEntry(path) && lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Recursive tools cannot filter protected descendants on our behalf.
export function isSafeSessionHistoryTree(path: string): boolean {
  try {
    if (!isSafeEntry(path)) return false;
    if (!lstatSync(path).isDirectory()) return true;
    return readdirSync(path).every((name) => isSafeSessionHistoryTree(join(path, name)));
  } catch {
    return false;
  }
}

export async function findSessionHistory(root: string, pattern: string, limit: number) {
  const matches: Array<{ path: string; id: string; timestamp: string; cwd: string }> = [];
  if (!isSessionHistoryDirectory(root)) throw new Error("session-history root must be an existing non-symlink, non-protected directory");
  for (const project of readdirSync(root, { withFileTypes: true })) {
    const projectPath = join(root, project.name);
    if (!project.isDirectory() || !isSafeEntry(projectPath)) continue;
    for (const file of readdirSync(projectPath, { withFileTypes: true })) {
      const path = join(projectPath, file.name);
      if (!file.isFile() || !file.name.endsWith(".jsonl") || !isSafeEntry(path)) continue;
      let header: { path: string; id: string; timestamp: string; cwd: string } | undefined;
      let matched = false;
      const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
      for await (const line of lines) {
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        if (!record || typeof record !== "object") continue;
        if (record.type === "session" && typeof record.id === "string"
          && typeof record.timestamp === "string" && Number.isFinite(Date.parse(record.timestamp))
          && typeof record.cwd === "string") {
          header = { path, id: record.id, timestamp: record.timestamp, cwd: record.cwd };
        }
        if (record.type === "message" && line.toLowerCase().includes(pattern.toLowerCase())) matched = true;
      }
      if (header && matched) matches.push(header);
    }
  }
  return matches.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.path.localeCompare(b.path)).slice(0, limit);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export async function extractSessionHistoryField(root: string, args: string[]) {
  const request = parseSessionHistoryExtraction(args);
  if (!request) throw new Error("invalid session extraction arguments");
  if (!isSessionHistoryDirectory(root)) throw new Error("session-history root must be an existing non-symlink, non-protected directory");
  let selected: unknown;
  let found = false;
  let sessionFound = false;
  for (const project of readdirSync(root, { withFileTypes: true })) {
    const projectPath = join(root, project.name);
    if (!project.isDirectory() || !isSafeEntry(projectPath)) continue;
    for (const file of readdirSync(projectPath, { withFileTypes: true })) {
      const path = join(projectPath, file.name);
      if (!file.isFile() || !file.name.endsWith(`_${request.session}.jsonl`) || !isSafeEntry(path)) continue;
      const input = createReadStream(path);
      const lines = createInterface({ input, crlfDelay: Infinity });
      let first = true;
      try {
        for await (const line of lines) {
          let record: unknown;
          try { record = JSON.parse(line); } catch { throw new Error("invalid JSON before selected record"); }
          if (first) {
            first = false;
            if (!isObject(record) || record.type !== "session" || record.id !== request.session) {
              throw new Error("session filename/header mismatch");
            }
            if (sessionFound) throw new Error("ambiguous session ID");
            sessionFound = true;
          }
          if (!isObject(record) || record.id !== request.record) continue;
          found = true;
          selected = record;
          // The selected record is complete; a partially written tail is irrelevant.
          break;
        }
      } finally {
        lines.close();
        input.destroy();
      }
    }
  }
  if (!sessionFound) throw new Error("session not found");
  if (!found) throw new Error("record not found");
  for (const key of request.field.split(".")) {
    if (!isObject(selected) || !Object.hasOwn(selected, key)) throw new Error(`field not found: ${request.field}`);
    selected = selected[key];
  }
  const text = typeof selected === "string" ? selected : JSON.stringify(selected, null, 2);
  if (text === undefined) throw new Error("field is not JSON data");
  if (request.offset > text.length) throw new Error("offset exceeds field length");
  const end = Math.min(request.offset + request.limit, text.length);
  return {
    ...request,
    totalCharacters: text.length,
    nextOffset: end < text.length ? end : null,
    text: text.slice(request.offset, end),
  };
}

if (import.meta.main) {
  try {
    const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
    if (realpathSync(process.cwd()) !== realpathSync(harnessRoot)) throw new Error("run from the canonical coding-harness root");
    const args = process.argv.slice(2);
    if (parseSessionHistoryExtraction(args)) {
      console.log(JSON.stringify(await extractSessionHistoryField(sessionHistoryRoot(), args)));
    } else {
      const [matchFlag, pattern, limitFlag, rawLimit, ...extra] = args;
      if (matchFlag !== "--match" || !pattern || limitFlag !== "--limit"
        || !/^[1-9]\d*$/.test(rawLimit ?? "") || Number(rawLimit) > 100 || extra.length) {
        throw new Error('usage: session-history.ts --match "topic" --limit 25 (1–100), or --session UUID --record ID --field message.content --offset 0 --limit 2000 (1–2000 characters)');
      }
      for (const session of await findSessionHistory(sessionHistoryRoot(), pattern, Number(rawLimit))) {
        console.log(JSON.stringify(session));
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
