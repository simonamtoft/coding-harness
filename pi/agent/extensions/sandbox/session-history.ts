import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isProtectedSecretPath, isWithin } from "./policy.ts";
import { parseSessionHistoryExtraction } from "./session-history-command.ts";

export function sessionHistoryRoot(): string {
  return join(homedir(), ".pi", "agent", "sessions");
}

export function currentRepositoryRoot(cwd: string): string | undefined {
  try {
    const env = { ...process.env };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_CEILING_DIRECTORIES", "GIT_COMMON_DIR"]) delete env[key];
    const root = realpathSync.native(execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env,
    }).trim());
    const home = realpathSync.native(homedir());
    if (!isWithin(root, realpathSync.native(cwd)) || isWithin(root, home) || !existsSync(join(root, ".git"))) return;
    return root;
  } catch { return; }
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

function reportedWorkerCost(result: Record<string, unknown>): number | undefined {
  const usage = result.usage;
  if (!isObject(usage) || typeof usage.cost !== "number" || !Number.isFinite(usage.cost) || usage.cost < 0
    || !Array.isArray(result.messages)) return;
  const assistantMessages = result.messages.filter((message) => isObject(message) && message.role === "assistant");
  if (assistantMessages.length === 0) return;
  let total = 0;
  for (const message of assistantMessages) {
    if (!isObject(message) || !isObject(message.usage) || !isObject(message.usage.cost)
      || typeof message.usage.cost.total !== "number" || !Number.isFinite(message.usage.cost.total)
      || message.usage.cost.total < 0) return;
    total += message.usage.cost.total;
  }
  if (Math.abs(total - usage.cost) > 0.000001) return;
  return usage.cost;
}

async function sessionHeaders(root: string) {
  if (!isSessionHistoryDirectory(root)) throw new Error("session-history root must be an existing non-symlink, non-protected directory");
  const candidates: Array<{ path: string; id: string; timestamp: string; cwd: string }> = [];
  for (const project of readdirSync(root, { withFileTypes: true })) {
    const projectPath = join(root, project.name);
    if (!project.isDirectory() || !isSafeEntry(projectPath)) continue;
    for (const file of readdirSync(projectPath, { withFileTypes: true })) {
      const path = join(projectPath, file.name);
      if (!file.isFile() || !file.name.endsWith(".jsonl") || !isSafeEntry(path)) continue;
      const input = createReadStream(path);
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          let header: unknown;
          try { header = JSON.parse(line); } catch { break; }
          if (isObject(header) && header.type === "session" && typeof header.id === "string"
            && typeof header.timestamp === "string" && Number.isFinite(Date.parse(header.timestamp))
            && typeof header.cwd === "string") {
            candidates.push({ path, id: header.id, timestamp: header.timestamp, cwd: header.cwd });
          }
          break;
        }
      } finally {
        lines.close();
        input.destroy();
      }
    }
  }
  return candidates.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.path.localeCompare(b.path));
}

export async function isRepositorySessionTranscript(root: string, path: string, repositoryRoot: string): Promise<boolean> {
  if (!isSessionHistoryDirectory(root) || !isWithin(root, path) || dirname(dirname(path)) !== root
    || !path.endsWith(".jsonl") || !isSessionHistoryDirectory(dirname(path))) return false;
  try {
    if (!isSafeEntry(path) || !lstatSync(path).isFile()) return false;
    const input = createReadStream(path);
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        const header: unknown = JSON.parse(line);
        if (!isObject(header) || header.type !== "session" || typeof header.cwd !== "string") return false;
        const cwd = realpathSync.native(header.cwd);
        return isWithin(realpathSync.native(repositoryRoot), cwd)
          && currentRepositoryRoot(cwd) === realpathSync.native(repositoryRoot);
      }
    } finally {
      lines.close();
      input.destroy();
    }
  } catch { return false; }
  return false;
}

export async function listRecentSessionHistory(root: string, repositoryRoot: string, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("recent limit must be 1–100");
  const candidates = await sessionHeaders(root);
  const resolvedRoot = realpathSync.native(repositoryRoot);
  const matches = [];
  for (const candidate of candidates) {
    let cwd: string;
    try { cwd = realpathSync.native(candidate.cwd); } catch { continue; }
    if (isWithin(resolvedRoot, cwd) && currentRepositoryRoot(cwd) === resolvedRoot) matches.push(candidate);
    if (matches.length === limit) break;
  }
  return matches;
}

/** Metadata-only audit: never return prompt, tool arguments, or worker output. */
export async function auditRecentBulkReads(root: string, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("audit limit must be 1–200");
  const candidates = await sessionHeaders(root);
  const report = [];
  for (const candidate of candidates.slice(0, limit)) {
    const { path, ...header } = candidate;
    const row = { ...header, topicPrompt: false, parentReadCalls: 0, redirects: 0, dispatches: 0, successes: 0, failures: 0,
      laterParentReads: 0, coveredParentReads: 0, coveredParentReadBytes: 0, workerCost: 0, unreportedWorkerCosts: 0,
      estimates: [] as Array<{ direct: number; delegated: number; readTokens: number; worker: number }> };
    const dispatches = new Map<string, { cwds: string[]; model: string; dispatchChars: number; single: boolean }>();
    const prices = new Map<string, { input?: number; output?: number }>();
    const runs: Array<{ model: string; readChars: number; resultChars: number; dispatchChars: number; worker: number }> = [];
    const covered = new Set<string>();
    const parentReads = new Map<string, string>();
    let sawSuccess = false;
    const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    for await (const line of lines) {
      let record: unknown;
      try { record = JSON.parse(line); } catch { continue; }
      if (!isObject(record) || record.type !== "message" || !isObject(record.message)) continue;
      const message = record.message;
      if (message.role === "user") {
        row.topicPrompt ||= typeof message.content === "string"
          ? /\bPI-62\b|bulk.read|bulk.reader/i.test(message.content)
          : Array.isArray(message.content) && message.content.some((part) => isObject(part)
            && typeof part.text === "string" && /\bPI-62\b|bulk.read|bulk.reader/i.test(part.text));
      }
      if (message.role === "assistant" && Array.isArray(message.content)) {
        const model = `${message.provider}/${message.model}`;
        if (isObject(message.usage) && isObject(message.usage.cost)) {
          const price = prices.get(model) ?? {};
          if (typeof message.usage.input === "number" && message.usage.input > 0
            && typeof message.usage.cost.input === "number") price.input = message.usage.cost.input / message.usage.input;
          if (typeof message.usage.output === "number" && message.usage.output > 0
            && typeof message.usage.cost.output === "number") price.output = message.usage.cost.output / message.usage.output;
          prices.set(model, price);
        }
        for (const part of message.content) {
          if (!isObject(part) || part.type !== "toolCall") continue;
          if (part.name === "read") {
            row.parentReadCalls++;
            if (sawSuccess) row.laterParentReads++;
            if (typeof part.id === "string" && isObject(part.arguments) && typeof part.arguments.path === "string"
              && covered.has(resolve(candidate.cwd, part.arguments.path.replace(/^@/, "")))) {
              parentReads.set(part.id, resolve(candidate.cwd, part.arguments.path.replace(/^@/, "")));
            }
          }
          if (part.name !== "subagent" || !isObject(part.arguments)) continue;
          const args = part.arguments;
          const selected = args.agent === "bulk-reader" || [args.tasks, args.chain].some((items) =>
            Array.isArray(items) && items.some((task) => isObject(task) && task.agent === "bulk-reader"));
          if (!selected) continue;
          row.dispatches++;
          if (typeof part.id === "string") {
            const tasks = Array.isArray(args.tasks) ? args.tasks : Array.isArray(args.chain) ? args.chain : [args];
            dispatches.set(part.id, {
              cwds: tasks.map((task) => isObject(task) && typeof task.cwd === "string"
                ? resolve(candidate.cwd, task.cwd) : candidate.cwd),
              model,
              dispatchChars: JSON.stringify(part.arguments).length,
              single: args.agent === "bulk-reader" && tasks.length === 1,
            });
          }
        }
      }
      if (message.role !== "toolResult") continue;
      if (message.toolName === "read" && typeof message.toolCallId === "string") {
        if (parentReads.delete(message.toolCallId) && message.isError !== true && Array.isArray(message.content)) {
          row.coveredParentReads++;
          row.coveredParentReadBytes += message.content.reduce((bytes, part) =>
            bytes + (isObject(part) && typeof part.text === "string" ? Buffer.byteLength(part.text) : 0), 0);
        }
      }
      if (message.toolName === "read" && Array.isArray(message.content)
        && message.content.some((part) => isObject(part) && typeof part.text === "string"
          && part.text.startsWith("Bulk read routed."))) row.redirects++;
      if (typeof message.toolCallId !== "string") continue;
      const dispatch = dispatches.get(message.toolCallId);
      if (!dispatch) continue;
      dispatches.delete(message.toolCallId);
      const results = isObject(message.details) ? message.details.results : undefined;
      if (!Array.isArray(results)) continue;
      for (const [index, result] of results.entries()) {
        if (!isObject(result) || result.agent !== "bulk-reader") continue;
        const workerCwd = dispatch.cwds[index] ?? candidate.cwd;
        const cost = reportedWorkerCost(result);
        if (cost === undefined) row.unreportedWorkerCosts++;
        else row.workerCost += cost;
        if (result.status === "failed" || result.stopReason === "error" || result.stopReason === "aborted"
          || (typeof result.exitCode === "number" && result.exitCode !== 0 && result.exitCode !== -1)) row.failures++;
        else if (result.exitCode === 0) {
          row.successes++;
          sawSuccess = true;
          const pending = new Map<string, string>();
          let readChars = 0;
          if (Array.isArray(result.messages)) for (const child of result.messages) {
            if (!isObject(child)) continue;
            if (child.role === "assistant" && Array.isArray(child.content)) for (const part of child.content) {
              if (isObject(part) && part.type === "toolCall" && part.name === "read"
                && typeof part.id === "string" && isObject(part.arguments) && typeof part.arguments.path === "string") {
                pending.set(part.id, resolve(workerCwd, part.arguments.path.replace(/^@/, "")));
              }
            }
            if (child.role === "toolResult" && child.toolName === "read" && child.isError !== true
              && typeof child.toolCallId === "string") {
              const path = pending.get(child.toolCallId);
              if (path) {
                covered.add(path);
                if (!path.endsWith("/bulk-read/BULK-READER.md") && Array.isArray(child.content)) for (const part of child.content) {
                  if (isObject(part) && typeof part.text === "string") readChars += part.text.length;
                }
              }
            }
          }
          if (dispatch.single && results.length === 1 && readChars > 0 && cost !== undefined) {
            const resultChars = Array.isArray(message.content) ? message.content.reduce((n, part) =>
              n + (isObject(part) && typeof part.text === "string" ? part.text.length : 0), 0) : 0;
            runs.push({ model: dispatch.model, readChars, resultChars,
              dispatchChars: dispatch.dispatchChars, worker: cost });
          }
        }
      }
    }
    for (const run of runs) {
      const price = prices.get(run.model);
      if (price?.input === undefined || price.output === undefined) continue;
      const readTokens = run.readChars / 3.6;
      row.estimates.push({ direct: readTokens * price.input,
        delegated: run.worker + run.resultChars / 3.6 * price.input + run.dispatchChars / 3.6 * price.output,
        readTokens, worker: run.worker });
    }
    report.push(row);
  }
  return report;
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
    const args = process.argv.slice(2);
    if (args[0] !== "--recent" && realpathSync(process.cwd()) !== realpathSync(harnessRoot)) {
      throw new Error("run from the canonical coding-harness root");
    }
    if (args.length === 3 && args[0] === "--recent" && args[1] === "--limit"
      && /^(?:[1-9]|[1-9][0-9]|100)$/.test(args[2]!)) {
      const repositoryRoot = currentRepositoryRoot(process.cwd());
      if (!repositoryRoot) throw new Error("recent listing requires a Git repository narrower than the home directory");
      for (const session of await listRecentSessionHistory(sessionHistoryRoot(), repositoryRoot, Number(args[2]))) {
        console.log(JSON.stringify(session));
      }
    } else if (parseSessionHistoryExtraction(args)) {
      console.log(JSON.stringify(await extractSessionHistoryField(sessionHistoryRoot(), args)));
    } else if (args.length === 3 && args[0] === "--audit-bulk-reads" && args[1] === "--limit"
      && /^(?:[1-9]|[1-9][0-9]|1[0-9][0-9]|200)$/.test(args[2]!)) {
      const rows = await auditRecentBulkReads(sessionHistoryRoot(), Number(args[2]));
      const estimates = rows.flatMap((row) => row.estimates);
      const ratios = estimates.filter((run) => run.direct > 0)
        .map((run) => (run.direct - run.delegated) / run.direct).sort((a, b) => a - b);
      console.log(JSON.stringify({ type: "summary", sessions: rows.length,
        withRedirects: rows.filter((row) => row.redirects > 0).length,
        withDispatches: rows.filter((row) => row.dispatches > 0).length,
        withSuccessfulChildren: rows.filter((row) => row.successes > 0).length,
        withFailedChildren: rows.filter((row) => row.failures > 0).length,
        withTopicPrompts: rows.filter((row) => row.topicPrompt).length,
        parentReadCalls: rows.reduce((n, row) => n + row.parentReadCalls, 0),
        redirects: rows.reduce((n, row) => n + row.redirects, 0),
        dispatches: rows.reduce((n, row) => n + row.dispatches, 0),
        successes: rows.reduce((n, row) => n + row.successes, 0),
        failures: rows.reduce((n, row) => n + row.failures, 0),
        coveredParentReads: rows.reduce((n, row) => n + row.coveredParentReads, 0),
        coveredParentReadBytes: rows.reduce((n, row) => n + row.coveredParentReadBytes, 0),
        workerCost: rows.reduce((n, row) => n + row.workerCost, 0),
        unreportedWorkerCosts: rows.reduce((n, row) => n + row.unreportedWorkerCosts, 0),
        estimatedRuns: estimates.length,
        modeledDirectCost: estimates.reduce((n, run) => n + run.direct, 0),
        modeledDelegatedCost: estimates.reduce((n, run) => n + run.delegated, 0),
        meanRunSavingRatio: ratios.length ? ratios.reduce((n, ratio) => n + ratio, 0) / ratios.length : null,
        medianRunSavingRatio: ratios.length ? ratios.length % 2 === 0
          ? (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2
          : ratios[Math.floor(ratios.length / 2)] : null }));
      for (const row of rows) console.log(JSON.stringify(row));
    } else {
      const [matchFlag, pattern, limitFlag, rawLimit, ...extra] = args;
      if (matchFlag !== "--match" || !pattern || limitFlag !== "--limit"
        || !/^[1-9]\d*$/.test(rawLimit ?? "") || Number(rawLimit) > 100 || extra.length) {
        throw new Error('usage: session-history.ts --recent --limit 25 (1–100), --audit-bulk-reads --limit 200, --match "topic" --limit 25 (1–100), or --session UUID --record ID --field message.content --offset 0 --limit 2000 (1–2000 characters)');
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
