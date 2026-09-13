import { realpathSync, statSync, type Stats } from "node:fs";
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
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

function isDirectDocument(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  if (NATIVE_DOCUMENT_EXTENSIONS.has(extension)) return true;
  if (GOVERNING_NAMES.has(basename(filePath).toLowerCase())) return true;
  if (extension !== ".md") return false;
  const parts = filePath.toLowerCase().split(sep);
  return parts.slice(0, -1).some((part) => GOVERNING_DIRS.has(part))
    || parts.some((part, index) => part === ".claude" && parts[index + 1] === "rules");
}

function resolveReadPath(rawPath: string, cwd: string): { filePath: string; info?: Stats } {
  let normalizedPath = rawPath.replace(/^@/, "").replace(UNICODE_SPACES, " ");
  if (normalizedPath === "~" || normalizedPath.startsWith("~/")) normalizedPath = join(homedir(), normalizedPath.slice(1));
  if (normalizedPath.startsWith("file://")) normalizedPath = fileURLToPath(normalizedPath);
  const resolvedPath = resolve(cwd, normalizedPath);
  const nfdPath = resolvedPath.normalize("NFD");
  const candidates = [
    resolvedPath,
    resolvedPath.replace(/ (AM|PM)\./gi, " $1."),
    nfdPath,
    resolvedPath.replace(/'/g, "’"),
    nfdPath.replace(/'/g, "’"),
  ];

  for (const filePath of candidates) {
    try {
      return { filePath, info: statSync(filePath) };
    } catch {
      // Preserve the native read tool's fallback behavior for missing or inaccessible paths.
    }
  }
  return { filePath: resolvedPath };
}

export function bulkReadRedirect(input: { path?: unknown; limit?: unknown }, cwd: string): string | undefined {
  if (typeof input.path !== "string" || !input.path) return;
  if (typeof input.limit === "number" && Number.isInteger(input.limit)
    && input.limit > 0 && input.limit <= MAX_BOUNDED_READ_LINES) return;

  try {
    const { filePath, info } = resolveReadPath(input.path, cwd);
    if (isDirectDocument(filePath) || !info || !info.isFile() || info.size <= MAX_DIRECT_BYTES) return;
    if (isDirectDocument(realpathSync(filePath))) return;
  } catch {
    // Missing or inaccessible files belong to the read tool, not the cost policy.
    return;
  }

  return `Bulk read routed. Read ${join(homedir(), ".pi/agent/skills/bulk-read/SKILL.md")} and delegate extraction to bulk-reader with the paths and a specific question. If you need original source for reasoning or editing, use read with offset and limit (1–${MAX_BOUNDED_READ_LINES} lines). Offset alone is not bounded. Do not bypass via Bash or oversized limits. Security checks still apply.`;
}
