import { describe, expect, test } from "bun:test";

import { hashFileSet, hashScenario, sha256Hex } from "./hashing.ts";
import type { Scenario } from "./types.ts";

const scenario: Scenario = {
  id: "demo",
  kind: "multi-turn",
  prompt: "do the thing",
  judge: "did it",
  checkCommand: ["bun", "test"],
  assertions: { checksPass: true },
};

describe("hashScenario", () => {
  test("is stable across fixture iteration order", () => {
    const a = hashScenario(scenario, new Map([["a.ts", "1"], ["b.ts", "2"]]));
    const b = hashScenario(scenario, new Map([["b.ts", "2"], ["a.ts", "1"]]));
    expect(a).toBe(b);
  });

  test("changes when fixture content changes", () => {
    const before = hashScenario(scenario, new Map([["a.ts", "1"]]));
    const after = hashScenario(scenario, new Map([["a.ts", "2"]]));
    expect(after).not.toBe(before);
  });

  test("changes when a fixture file is added", () => {
    const before = hashScenario(scenario, new Map([["a.ts", "1"]]));
    const after = hashScenario(scenario, new Map([["a.ts", "1"], ["b.ts", "1"]]));
    expect(after).not.toBe(before);
  });

  test("changes when the definition changes", () => {
    const before = hashScenario(scenario, new Map());
    const after = hashScenario({ ...scenario, prompt: "do another thing" }, new Map());
    expect(after).not.toBe(before);
  });

  test("changes when a nested assertion changes", () => {
    const before = hashScenario(scenario, new Map());
    expect(hashScenario({ ...scenario, assertions: { checksPass: false } }, new Map())).not.toBe(before);
    expect(hashScenario({ ...scenario, assertions: { checksPass: true, filesChanged: ["src/format.ts"] } }, new Map()))
      .not.toBe(before);
    expect(hashScenario({ ...scenario, assertions: { checksPass: true, ranCommandMatching: ["bun test"] } }, new Map()))
      .not.toBe(before);
    expect(hashScenario({ ...scenario, assertions: { checksPass: true, ranAnyCommandMatching: ["npm test"] } }, new Map()))
      .not.toBe(before);
  });

  test("ignores key order inside nested objects", () => {
    const a = hashScenario({ ...scenario, assertions: { checksPass: true, filesChanged: ["a", "b"] } }, new Map());
    const b = hashScenario({ ...scenario, assertions: { filesChanged: ["a", "b"], checksPass: true } }, new Map());
    expect(a).toBe(b);
  });

  test("distinguishes array order, which is meaningful for commands", () => {
    const a = hashScenario({ ...scenario, checkCommand: ["bun", "test"] }, new Map());
    const b = hashScenario({ ...scenario, checkCommand: ["test", "bun"] }, new Map());
    expect(a).not.toBe(b);
  });
});

test("sha256Hex distinguishes instruction variants", () => {
  expect(sha256Hex("rule text")).not.toBe(sha256Hex("rule text\nextra paragraph"));
});

describe("hashFileSet", () => {
  test("is stable across traversal order", () => {
    const a = hashFileSet(new Map([["extensions/a.ts", new TextEncoder().encode("a")], ["skills/b.md", new TextEncoder().encode("b")]]));
    const b = hashFileSet(new Map([["skills/b.md", new TextEncoder().encode("b")], ["extensions/a.ts", new TextEncoder().encode("a")]]));
    expect(a).toBe(b);
  });

  test("changes with a runtime path or raw file bytes", () => {
    const original = hashFileSet(new Map([["extensions/a.ts", Uint8Array.from([0xff, 0x00])]]));
    expect(hashFileSet(new Map([["extensions/a.ts", Uint8Array.from([0xfe, 0x00])]]))).not.toBe(original);
    expect(hashFileSet(new Map([["extensions/b.ts", Uint8Array.from([0xff, 0x00])]]))).not.toBe(original);
  });
});
