import { sha256Hex } from "./hashing.ts";
import type { FixtureSpec } from "./types.ts";

class ManifestError extends Error {}

const COMMIT_SHA = /^[0-9a-f]{40}$/;

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new ManifestError(`${field} must be a non-empty string`);
  return value;
}

function parseSetup(value: unknown, field: string): string[][] {
  if (value === undefined) return [];
  const valid = Array.isArray(value) && value.every((command) =>
    Array.isArray(command) && command.length > 0 && command.every((arg) => typeof arg === "string" && arg.trim() !== ""));
  if (!valid) throw new ManifestError(`${field} must be an array of non-empty commands`);
  return value as string[][];
}

/** Parses `probes/fixtures.json`: `{ "fixtures": { "<name>": { repository, commit, licence, contamination, setup? } } }`. */
export function parseFixtureManifest(raw: unknown): Map<string, FixtureSpec> {
  if (typeof raw !== "object" || raw === null || typeof (raw as Record<string, unknown>).fixtures !== "object") {
    throw new ManifestError("fixture manifest must be an object with a fixtures object");
  }
  const fixtures = new Map<string, FixtureSpec>();
  for (const [name, entry] of Object.entries((raw as { fixtures: Record<string, unknown> }).fixtures)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new ManifestError(`fixture name ${name} must be lowercase kebab-case`);
    if (typeof entry !== "object" || entry === null) throw new ManifestError(`fixture ${name} must be an object`);
    const record = entry as Record<string, unknown>;
    const commit = requireString(record.commit, `fixture ${name}: commit`);
    if (!COMMIT_SHA.test(commit)) throw new ManifestError(`fixture ${name}: commit must be a full 40-character lowercase SHA`);
    fixtures.set(name, {
      name,
      repository: requireString(record.repository, `fixture ${name}: repository`),
      commit,
      licence: requireString(record.licence, `fixture ${name}: licence`),
      contamination: requireString(record.contamination, `fixture ${name}: contamination`),
      setup: parseSetup(record.setup, `fixture ${name}: setup`),
    });
  }
  return fixtures;
}

/**
 * What a provisioned checkout contains: repository, commit, and setup. Licence and contamination
 * notes are report metadata and do not invalidate cached checkouts or records.
 */
export function fixtureIdentity(spec: FixtureSpec): string {
  return sha256Hex(JSON.stringify([spec.repository, spec.commit, spec.setup]));
}

/** Written into the cache after a successful provisioning run. */
export type ProvisionStamp = { identity: string; commit: string; provisionedAt: string };

export function isProvisioned(stamp: unknown, spec: FixtureSpec): boolean {
  return typeof stamp === "object" && stamp !== null && (stamp as ProvisionStamp).identity === fixtureIdentity(spec);
}
