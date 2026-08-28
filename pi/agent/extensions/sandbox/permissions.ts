import { chmodSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PRIVATE_CONFIG_FILES = [
  "auth.json",
  "consumption.json",
  "models-store.json",
  "models.json",
  "settings.json",
  "settings.json.pre-plugins.bak",
  "subagents.json",
  "trust.json",
];

function setMode(path: string, mode: number): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || (stats.mode & 0o777) === mode) return;
  chmodSync(path, mode);
}

function hardenTree(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) return;
  if (!stats.isDirectory()) {
    setMode(path, 0o600);
    return;
  }

  setMode(path, 0o700);
  for (const entry of readdirSync(path)) hardenTree(join(path, entry));
}

export function hardenPiPermissions(agentDirectory: string): void {
  if (!existsSync(agentDirectory)) return;
  setMode(agentDirectory, 0o700);

  for (const filename of PRIVATE_CONFIG_FILES) {
    const path = join(agentDirectory, filename);
    if (existsSync(path)) setMode(path, 0o600);
  }

  const sessionsDirectory = join(agentDirectory, "sessions");
  if (existsSync(sessionsDirectory)) hardenTree(sessionsDirectory);
}
