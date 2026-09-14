import { createReadStream, lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isProtectedSecretPath } from "./policy.ts";

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

if (import.meta.main) {
  try {
    const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
    if (realpathSync(process.cwd()) !== realpathSync(harnessRoot)) throw new Error("run from the canonical coding-harness root");
    const [matchFlag, pattern, limitFlag, rawLimit, ...extra] = process.argv.slice(2);
    if (matchFlag !== "--match" || !pattern || limitFlag !== "--limit"
      || !/^[1-9]\d*$/.test(rawLimit ?? "") || Number(rawLimit) > 100 || extra.length) {
      throw new Error('usage: bun pi/agent/extensions/sandbox/session-history.ts --match "playwright" --limit 25 (1–100)');
    }
    for (const session of await findSessionHistory(sessionHistoryRoot(), pattern, Number(rawLimit))) {
      console.log(JSON.stringify(session));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
