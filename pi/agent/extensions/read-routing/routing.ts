import { realpathSync, statSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { BulkReaderSession } from "./coverage.ts";

const MAX_BOUNDED_READ_LINES = 350;
const MAX_DIRECT_BYTES = 16 * 1024;
const GOVERNING_NAMES = new Set([
  "agents.md", "claude.md", "claude.local.md", "skill.md", "system.md", "append_system.md",
  "context.md", "context-map.md", "decisions.md",
]);
const GOVERNING_DIRS = new Set(["skills", "agents", "adr", "adrs", "decisions"]);
const NATIVE_DOCUMENT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".pdf", ".ipynb"]);
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

export function isDirectDocument(filePath: string): boolean {
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

const BOUNDED_READ_RULE = `A bounded read (offset plus limit of 1–${MAX_BOUNDED_READ_LINES} lines) is for exact source behind one specific claim, not for paging the file. Offset alone is not bounded. Do not bypass via Bash or oversized limits. Security checks still apply.`;

function redirectReason(filePath: string, session: BulkReaderSession | undefined): string {
  if (session?.coveredFiles.has(filePath)) {
    return `Bulk read routed. bulk-reader already read this file in this session; use its source-backed findings and citations. For a further factual question, dispatch bulk-reader again with the follow-up question. ${BOUNDED_READ_RULE}`;
  }
  if (session?.workerFailed) {
    return `Bulk read routed. bulk-reader failed earlier in this session; do not redispatch the same assignment. Read a bounded section for the specific claim you need, or report the limitation. ${BOUNDED_READ_RULE}`;
  }
  return `Bulk read routed. Read ${join(homedir(), ".pi/agent/skills/bulk-read/SKILL.md")} and delegate extraction to bulk-reader with the paths and a specific question. ${BOUNDED_READ_RULE}`;
}

export function bulkReadRedirect(
  input: { path?: unknown; limit?: unknown },
  cwd: string,
  session?: BulkReaderSession,
): string | undefined {
  if (typeof input.path !== "string" || !input.path) return;
  if (typeof input.limit === "number" && Number.isInteger(input.limit)
    && input.limit > 0 && input.limit <= MAX_BOUNDED_READ_LINES) return;

  let filePath: string;
  try {
    const resolved = resolveReadPath(input.path, cwd);
    filePath = resolved.filePath;
    const { info } = resolved;
    if (isDirectDocument(filePath) || !info || !info.isFile() || info.size <= MAX_DIRECT_BYTES) return;
    if (isDirectDocument(realpathSync(filePath))) return;
  } catch {
    // Missing or inaccessible files belong to the read tool, not the cost policy.
    return;
  }

  return redirectReason(filePath, session);
}
