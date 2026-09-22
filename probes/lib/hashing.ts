import { createHash } from "node:crypto";

import type { Scenario } from "./types.ts";

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function sha256Bytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Identity of a named file set; paths and raw bytes are both significant. */
export function hashFileSet(files: Map<string, Uint8Array>): string {
  const manifest = [...files.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, content]) => `${path}\u0000${sha256Bytes(content)}`)
    .join("\n");
  return sha256Hex(manifest);
}

/** Stable serialization: object keys sorted at every depth, arrays kept in order. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Identity of a scenario as executed: its definition plus every fixture file.
 * Editing either side must invalidate cached records for both variants.
 */
export function hashScenario(scenario: Scenario, fixtureFiles: Map<string, string>): string {
  const definition = canonicalize(scenario);
  const fixture = [...fixtureFiles.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, content]) => `${path}\u0000${sha256Hex(content)}`)
    .join("\n");
  return sha256Hex(`${definition}\n--fixture--\n${fixture}`);
}
