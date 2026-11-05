import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ProjectSnapshot } from "./change-scope.ts";
import type { Verifier } from "./verifier.ts";

/** Verifier entry-point content the session has accepted: its first observed state, or one a review cleared or the user accepted. */
export interface AcceptedVerifier {
  /** Empty when the session started without a verifier, so any verifier that appears later is reviewed. */
  path: string;
  digest: string | undefined;
  revision: string | undefined;
  /** Accepted entry-point text, so a review judges only the edit since acceptance; undefined when absent or too large. */
  content: string | undefined;
}

export const NO_VERIFIER: AcceptedVerifier = { path: "", digest: undefined, revision: undefined, content: undefined };

const MAX_ACCEPTED_CONTENT_BYTES = 64 * 1024;

export async function readVerifierContent(cwd: string, path: string): Promise<string | undefined> {
  try {
    const content = await readFile(join(cwd, path));
    return content.byteLength > MAX_ACCEPTED_CONTENT_BYTES ? undefined : content.toString("utf8");
  } catch {
    return undefined;
  }
}

export function verifierEntryPath(verifier: Verifier, cwd: string): string {
  if (verifier.label === ".agent/verify.sh") return ".agent/verify.sh";
  return relative(cwd, verifier.args[1]);
}

export function acceptVerifier(path: string, snapshot: ProjectSnapshot, content: string | undefined): AcceptedVerifier {
  return { path, digest: snapshot.files.get(path), revision: snapshot.revision, content };
}

export function verifierChangedSinceAccepted(
  accepted: AcceptedVerifier,
  path: string,
  snapshot: ProjectSnapshot,
): boolean {
  return accepted.path !== path || accepted.digest !== snapshot.files.get(path);
}

export function changedPaths(before: ProjectSnapshot | undefined, after: ProjectSnapshot): string[] {
  if (!before) return [];
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  return [...paths].filter((path) => before.files.get(path) !== after.files.get(path)).sort();
}
