import { describe, expect, test } from "bun:test";

import { fixtureIdentity, isProvisioned, parseFixtureManifest } from "./fixtures.ts";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const entry = {
  repository: "https://github.com/example/demo.git",
  commit: COMMIT,
  licence: "MIT",
  contamination: "public since 2021; likely in training data",
  setup: [["bun", "install", "--frozen-lockfile"]],
};

describe("parseFixtureManifest", () => {
  test("parses pinned fixtures by name", () => {
    expect(parseFixtureManifest({ fixtures: { demo: entry } }).get("demo")).toEqual({ name: "demo", ...entry });
  });

  test("defaults setup to no commands", () => {
    const { setup: _, ...withoutSetup } = entry;
    expect(parseFixtureManifest({ fixtures: { demo: withoutSetup } }).get("demo")?.setup).toEqual([]);
  });

  test("requires a full lowercase commit SHA, never a branch or short SHA", () => {
    for (const commit of ["main", COMMIT.slice(0, 12), COMMIT.toUpperCase()]) {
      expect(() => parseFixtureManifest({ fixtures: { demo: { ...entry, commit } } })).toThrow(/40-character/);
    }
  });

  test("requires licence and contamination notes", () => {
    expect(() => parseFixtureManifest({ fixtures: { demo: { ...entry, licence: "" } } })).toThrow(/licence/);
    expect(() => parseFixtureManifest({ fixtures: { demo: { ...entry, contamination: undefined } } })).toThrow(/contamination/);
  });

  test("rejects malformed setup commands and names", () => {
    expect(() => parseFixtureManifest({ fixtures: { demo: { ...entry, setup: [[]] } } })).toThrow(/setup/);
    expect(() => parseFixtureManifest({ fixtures: { demo: { ...entry, setup: "bun install" } } })).toThrow(/setup/);
    expect(() => parseFixtureManifest({ fixtures: { Demo_1: entry } })).toThrow(/kebab-case/);
    expect(() => parseFixtureManifest({})).toThrow(/fixtures object/);
  });
});

describe("fixture identity and provisioning", () => {
  const spec = parseFixtureManifest({ fixtures: { demo: entry } }).get("demo")!;

  test("changes with repository, commit, or setup but not with report metadata", () => {
    expect(fixtureIdentity({ ...spec, commit: "f".repeat(40) })).not.toBe(fixtureIdentity(spec));
    expect(fixtureIdentity({ ...spec, setup: [] })).not.toBe(fixtureIdentity(spec));
    expect(fixtureIdentity({ ...spec, licence: "Apache-2.0", contamination: "unknown" })).toBe(fixtureIdentity(spec));
  });

  test("accepts only a stamp for the current identity", () => {
    expect(isProvisioned({ identity: fixtureIdentity(spec), commit: COMMIT, provisionedAt: "x" }, spec)).toBe(true);
    expect(isProvisioned({ identity: fixtureIdentity({ ...spec, setup: [] }) }, spec)).toBe(false);
    expect(isProvisioned(null, spec)).toBe(false);
  });
});
