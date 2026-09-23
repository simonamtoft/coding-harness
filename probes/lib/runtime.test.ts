import { describe, expect, test } from "bun:test";

import { packageManifestEntries, parsePiList, runtimeFingerprint, sanitizePackageSource } from "./runtime.ts";
import type { RuntimeIdentity } from "./types.ts";

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
