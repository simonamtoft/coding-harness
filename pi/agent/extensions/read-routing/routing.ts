import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BOUNDED_READ_LINES = 350;
const MAX_DIRECT_BYTES = 16 * 1024;
const GOVERNING_NAMES = new Set([
  "agents.md", "claude.md", "claude.local.md", "skill.md", "system.md", "append_system.md",
  "context.md", "context-map.md", "decisions.md",
]);
const GOVERNING_DIRS = new Set(["skills", "agents", "adr", "adrs", "decisions"]);
const NATIVE_DOCUMENT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".pdf", ".ipynb"]);

function isDirectDocument(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  if (NATIVE_DOCUMENT_EXTENSIONS.has(extension)) return true;
  if (GOVERNING_NAMES.has(basename(filePath).toLowerCase())) return true;
  if (extension !== ".md") return false;
  const parts = filePath.toLowerCase().split(sep);
  return parts.slice(0, -1).some((part) => GOVERNING_DIRS.has(part))
    || parts.some((part, index) => part === ".claude" && parts[index + 1] === "rules");
}

export function bulkReadRedirect(input: { path?: unknown; limit?: unknown }, cwd: string): string | undefined {
  if (typeof input.path !== "string" || !input.path) return;
  if (typeof input.limit === "number" && Number.isInteger(input.limit)
    && input.limit > 0 && input.limit <= MAX_BOUNDED_READ_LINES) return;

  try {
    let rawPath = input.path.replace(/^@/, "");
    if (rawPath === "~" || rawPath.startsWith("~/")) rawPath = join(homedir(), rawPath.slice(1));
    if (rawPath.startsWith("file://")) rawPath = fileURLToPath(rawPath);
    const filePath = resolve(cwd, rawPath);
    if (isDirectDocument(filePath)) return;
    const canonicalPath = realpathSync(filePath);
    if (isDirectDocument(canonicalPath)) return;
    const info = statSync(canonicalPath);
    if (!info.isFile() || info.size <= MAX_DIRECT_BYTES) return;
  } catch {
    // Missing or inaccessible files belong to the read tool, not the cost policy.
    return;
  }

  return `Bulk read routed: this file exceeds ${MAX_DIRECT_BYTES / 1024} KiB. Read ${join(homedir(), ".pi/agent/skills/bulk-read/SKILL.md")} and delegate extraction to bulk-reader with the paths and a specific question. If you need original source for reasoning or editing, use read with offset and limit (1–${MAX_BOUNDED_READ_LINES} lines). Offset alone is not bounded. Do not bypass via Bash or oversized limits. Security checks still apply.`;
}
