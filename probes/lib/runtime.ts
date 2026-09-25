import { sha256Hex } from "./hashing.ts";
import type { RuntimeIdentity } from "./types.ts";

export type ListedPackage = { source: string; resolvedPath: string };

/**
 * Parses `pi list`, which prints each configured source indented by two spaces followed by the
 * path Pi resolved it to, indented by four. Scope headers and other lines are ignored.
 */
export function parsePiList(stdout: string): ListedPackage[] {
  const packages: ListedPackage[] = [];
  let source: string | null = null;
  for (const line of stdout.split("\n")) {
    const resolved = /^ {4}(\S.*)$/.exec(line);
    if (resolved && source !== null) {
      packages.push({ source, resolvedPath: resolved[1].trim() });
      source = null;
      continue;
    }
    const configured = /^ {2}(\S.*)$/.exec(line);
    source = configured ? configured[1].trim() : null;
  }
  return packages;
}

const TOKEN_SUFFIX: Record<string, number> = { "": 1, K: 1_000, M: 1_000_000 };

/**
 * Context window of `provider/model` from `pi --list-models`, whose table prints it in a
 * `context` column rounded for display (`200K`, `262.1K`), so the result is approximate.
 * Null when the model or column is absent.
 */
export function parseContextWindow(stdout: string, model: string): number | null {
  const [header, ...rows] = stdout.split("\n").map((line) => line.trim().split(/\s+/));
  const column = header?.indexOf("context") ?? -1;
  if (column < 0) return null;
  const row = rows.find((cells) => `${cells[0]}/${cells[1]}` === model);
  const size = row ? /^(\d+(?:\.\d+)?)([KM]?)$/.exec(row[column] ?? "") : null;
  return size ? Math.round(Number(size[1]) * TOKEN_SUFFIX[size[2]]) : null;
}

/** Keeps registry sources, strips URL credentials, and reduces local paths to their directory name. */
export function sanitizePackageSource(source: string): string {
  if (source.startsWith("npm:")) return source;
  if (source.startsWith("git:")) return source.replace(/^git:[^@/]*@(?=[^/]*\/)/, "git:");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) return source.replace(/\/\/[^/@]*@/, "//");
  const name = source.replace(/\/+$/, "").split("/").pop() ?? source;
  return `local:${name}`;
}

/** Package sources from `pi/agent/packages.txt`, ignoring comments, blank lines, and whitespace. */
export function packageManifestEntries(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * Cache identity of a whole-mode runtime. Bun's version is recorded as a diagnostic but omitted:
 * it runs the probe runner, not the Pi child under test.
 */
export function runtimeFingerprint(identity: RuntimeIdentity): string {
  return sha256Hex(JSON.stringify({
    piVersion: identity.piVersion,
    packages: [...(identity.packages ?? [])]
      .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))
      .map(({ source, name, version, contentHash }) => [source, name, version, contentHash]),
  }));
}

/**
 * Epoch milliseconds from macOS `sysctl -n kern.sleeptime` output such as
 * `{ sec = 1790324820, usec = 807889 } Fri Sep 25 10:27:00 2026`; null when unrecognised or when
 * `sec = 0`, which means the host has not slept since boot.
 */
export function parseSysctlTimeval(output: string): number | null {
  const match = /\{\s*sec\s*=\s*(\d+),\s*usec\s*=\s*(\d+)\s*\}/.exec(output);
  if (!match) return null;
  const seconds = Number(match[1]);
  return seconds === 0 ? null : seconds * 1000 + Math.floor(Number(match[2]) / 1000);
}
