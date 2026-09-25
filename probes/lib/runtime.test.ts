import { describe, expect, test } from "bun:test";

import { packageManifestEntries, parseContextWindow, parsePiList, parseSysctlTimeval, runtimeFingerprint, sanitizePackageSource } from "./runtime.ts";
import type { RuntimeIdentity } from "./types.ts";

describe("parseSysctlTimeval", () => {
  test("reads seconds and microseconds as epoch milliseconds", () => {
    expect(parseSysctlTimeval("{ sec = 1790324820, usec = 807889 } Fri Sep 25 10:27:00 2026\n")).toBe(1790324820807);
  });

  test("treats a never-slept host and unrecognised output as unknown", () => {
    expect(parseSysctlTimeval("{ sec = 0, usec = 0 } Thu Jan  1 01:00:00 1970")).toBeNull();
    expect(parseSysctlTimeval("sysctl: unknown oid")).toBeNull();
  });
});

describe("parsePiList", () => {
  test("pairs each configured source with its resolved path", () => {
    const stdout = [
      "User packages:",
      "  ../../pi-plugins/pi-worktree-agents",
      "    /Users/me/pi-plugins/pi-worktree-agents",
      "  npm:pi-mcp-adapter@1.2.0",
      "    /Users/me/.pi/agent/npm/node_modules/pi-mcp-adapter",
      "",
    ].join("\n");
    expect(parsePiList(stdout)).toEqual([
      { source: "../../pi-plugins/pi-worktree-agents", resolvedPath: "/Users/me/pi-plugins/pi-worktree-agents" },
      { source: "npm:pi-mcp-adapter@1.2.0", resolvedPath: "/Users/me/.pi/agent/npm/node_modules/pi-mcp-adapter" },
    ]);
  });

  test("returns nothing when no packages are configured", () => {
    expect(parsePiList("No packages installed.\n")).toEqual([]);
  });
});

describe("sanitizePackageSource", () => {
  test("keeps registry and git sources", () => {
    expect(sanitizePackageSource("npm:@example/pi-tools@1.0.0")).toBe("npm:@example/pi-tools@1.0.0");
    expect(sanitizePackageSource("git:github.com/example/pi-tools@v1")).toBe("git:github.com/example/pi-tools@v1");
  });

  test("strips credentials from URL sources", () => {
    expect(sanitizePackageSource("https://user:token@github.com/example/pi-tools")).toBe("https://github.com/example/pi-tools");
    expect(sanitizePackageSource("git:user@github.com/example/pi-tools")).toBe("git:github.com/example/pi-tools");
  });

  test("reduces local paths to the package directory name", () => {
    expect(sanitizePackageSource("../../pi-plugins/pi-status-footer")).toBe("local:pi-status-footer");
    expect(sanitizePackageSource("/Users/me/pi-plugins/pi-status-footer/")).toBe("local:pi-status-footer");
  });
});

test("packageManifestEntries ignores comments and whitespace", () => {
  const edited = "# header\n\n  git:github.com/a/b  \n# npm:disabled\ngit:github.com/c/d\n";
  expect(packageManifestEntries(edited)).toEqual(["git:github.com/a/b", "git:github.com/c/d"]);
  expect(packageManifestEntries("git:github.com/a/b\ngit:github.com/c/d")).toEqual(packageManifestEntries(edited));
});

describe("runtimeFingerprint", () => {
  const identity: RuntimeIdentity = {
    piVersion: "0.87.1",
    bunVersion: "1.4.2",
    packages: [
      { source: "local:a", name: "a", version: "1.0.0", contentHash: "aaa" },
      { source: "local:b", name: "b", version: "1.0.0", contentHash: "bbb" },
    ],
  };

  test("ignores the Bun version and package order", () => {
    expect(runtimeFingerprint({ ...identity, bunVersion: "9.9.9", packages: [...identity.packages!].reverse() }))
      .toBe(runtimeFingerprint(identity));
  });

  test("changes with the Pi version or package content", () => {
    const base = runtimeFingerprint(identity);
    expect(runtimeFingerprint({ ...identity, piVersion: "0.88.0" })).not.toBe(base);
    expect(runtimeFingerprint({
      ...identity,
      packages: [identity.packages![0], { ...identity.packages![1], contentHash: "changed" }],
    })).not.toBe(base);
  });
});

describe("parseContextWindow", () => {
  const catalogue = [
    "provider      model                       context  max-out  thinking  images",
    "anthropic     claude-sonnet-5             1M       128K     yes       yes",
    "openai-codex  gpt-6-luna                  272K     128K     yes       yes",
    "openrouter    tiny                        262.1K   8K       no        no",
  ].join("\n");

  test("reads the rounded context column for an exact provider and model", () => {
    expect(parseContextWindow(catalogue, "anthropic/claude-sonnet-5")).toBe(1_000_000);
    expect(parseContextWindow(catalogue, "openai-codex/gpt-6-luna")).toBe(272_000);
    expect(parseContextWindow(catalogue, "openrouter/tiny")).toBe(262_100);
  });

  test("is null for an unlisted model or an unexpected table", () => {
    expect(parseContextWindow(catalogue, "anthropic/claude")).toBeNull();
    expect(parseContextWindow("no models configured", "anthropic/claude-sonnet-5")).toBeNull();
  });
});
