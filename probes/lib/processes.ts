/** `started` is the process start time as `ps` prints it; with `pid` it identifies one process. */
export type ProcessEntry = { pid: number; ppid: number; started: string };

/** Parses `ps -Ao pid=,ppid=,lstart=` output. */
export function parseProcessTable(stdout: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (match) entries.push({ pid: Number(match[1]), ppid: Number(match[2]), started: match[3] });
  }
  return entries;
}

/**
 * Every transitive child of `root`, found by parent links rather than process groups, because Pi
 * starts each Bash tool call in a detached group of its own.
 */
export function descendants(table: ProcessEntry[], root: number): ProcessEntry[] {
  const children = new Map<number, ProcessEntry[]>();
  for (const entry of table) {
    if (entry.pid === entry.ppid) continue;
    children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), entry]);
  }
  const found: ProcessEntry[] = [];
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      found.push(child);
      queue.push(child.pid);
    }
  }
  return found;
}

/**
 * The recorded processes that are still the same processes now: a pid whose start time changed
 * was reused by an unrelated process and must not be signalled.
 */
export function stillRunning(recorded: ProcessEntry[], current: ProcessEntry[]): ProcessEntry[] {
  const startedByPid = new Map(current.map((entry) => [entry.pid, entry.started]));
  return recorded.filter((entry) => startedByPid.get(entry.pid) === entry.started);
}
