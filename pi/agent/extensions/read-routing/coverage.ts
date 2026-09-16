import { relative, resolve, sep } from "node:path";
import { isDirectDocument } from "./routing.ts";

const BULK_READER = "bulk-reader";
const MAX_LISTED_FILES = 12;

export interface BulkReaderSession {
  /** Absolute paths the worker actually read; the parent has no citation reason to reread them. */
  coveredFiles: Set<string>;
  /** Set by a failed dispatch, cleared by a later successful one. */
  workerFailed: boolean;
}

export function createBulkReaderSession(): BulkReaderSession {
  return { coveredFiles: new Set(), workerFailed: false };
}

export function resetBulkReaderSession(session: BulkReaderSession): void {
  session.coveredFiles.clear();
  session.workerFailed = false;
}

interface WorkerResult {
  agent?: unknown;
  status?: unknown;
  errorMessage?: unknown;
  messages?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Paths of the worker's `read` calls whose tool result came back without an error. */
function workerReadPaths(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const requested = new Map<string, string>();
  const succeeded = new Set<string>();
  for (const message of messages) {
    if (!isRecord(message)) continue;
    if (message.role === "toolResult") {
      if (typeof message.toolCallId === "string" && message.isError !== true) succeeded.add(message.toolCallId);
      continue;
    }
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!isRecord(part) || part.type !== "toolCall" || part.name !== "read" || typeof part.id !== "string") continue;
      const path = isRecord(part.arguments) ? part.arguments.path : undefined;
      if (typeof path === "string" && path) requested.set(part.id, path);
    }
  }
  return [...requested].filter(([id]) => succeeded.has(id)).map(([, path]) => path);
}

function dispatchCwd(input: unknown, index: number, fallback: string): string {
  if (!isRecord(input)) return fallback;
  const entry = (Array.isArray(input.tasks) ? input.tasks[index] : undefined)
    ?? (Array.isArray(input.chain) ? input.chain[index] : undefined);
  const cwd = isRecord(entry) && typeof entry.cwd === "string" ? entry.cwd
    : typeof input.cwd === "string" ? input.cwd : undefined;
  return cwd ? resolve(fallback, cwd) : fallback;
}

export interface BulkReaderOutcome {
  /** Files newly covered by this result, absolute. */
  coveredFiles: string[];
  succeeded: boolean;
  errorMessage?: string;
}

/**
 * Records the bulk-reader dispatches in one subagent result. Returns undefined when
 * the result contains no bulk-reader run, so unrelated delegation stays untouched.
 */
export function recordBulkReaderResult(
  session: BulkReaderSession,
  input: unknown,
  details: unknown,
  fallbackCwd: string,
): BulkReaderOutcome | undefined {
  if (!isRecord(details) || !Array.isArray(details.results)) return;
  const outcome: BulkReaderOutcome = { coveredFiles: [], succeeded: false };
  let seen = false;
  details.results.forEach((result: WorkerResult, index) => {
    if (!isRecord(result) || result.agent !== BULK_READER) return;
    seen = true;
    if (result.status === "failed") {
      if (typeof result.errorMessage === "string") outcome.errorMessage = result.errorMessage;
      return;
    }
    outcome.succeeded = true;
    const cwd = dispatchCwd(input, index, fallbackCwd);
    for (const path of workerReadPaths(result.messages)) {
      const absolute = resolve(cwd, path.replace(/^@/, ""));
      // The worker's own brief and other governing documents are not evidence coverage.
      if (isDirectDocument(absolute)) continue;
      if (!session.coveredFiles.has(absolute)) outcome.coveredFiles.push(absolute);
      session.coveredFiles.add(absolute);
    }
  });
  if (!seen) return;
  session.workerFailed = !outcome.succeeded;
  return outcome;
}

function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel && !rel.startsWith(`..${sep}`) && rel !== ".." ? rel : path;
}

export function bulkReaderFooter(outcome: BulkReaderOutcome, cwd: string): string | undefined {
  if (!outcome.succeeded) {
    const detail = outcome.errorMessage ? ` (${outcome.errorMessage})` : "";
    return `[read-routing] bulk-reader failed${detail}. Do not redispatch the same assignment. Use bounded direct reads for the specific claims you need and report the limitation.`;
  }
  if (outcome.coveredFiles.length === 0) return;
  const listed = outcome.coveredFiles.slice(0, MAX_LISTED_FILES).map((path) => displayPath(path, cwd));
  const more = outcome.coveredFiles.length - listed.length;
  const files = listed.join(", ") + (more > 0 ? `, +${more} more` : "");
  return `[read-routing] bulk-reader read ${outcome.coveredFiles.length} file(s): ${files}. Its findings are source-backed for these files; treat its path and line-range citations as observed evidence and do not reread them to confirm or re-cite. For a further factual question, dispatch bulk-reader again with the follow-up question and paths. For exact source behind one specific unresolved claim, read the smallest relevant section. Paging these files in 350-line reads is a routing failure.`;
}
