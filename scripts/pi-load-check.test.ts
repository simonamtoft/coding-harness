import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkOverlay } from "./pi-load-check";

let root: string;

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("overlay links repository resources to the worktree and everything else to the agent dir", async () => {
  root = await mkdtemp(join(tmpdir(), "pi-load-check-test-"));
  const agentDir = join(root, "agent");
  const overlayDir = join(root, "overlay");
  await mkdir(join(agentDir, "git"), { recursive: true });
  await mkdir(join(agentDir, "skills"), { recursive: true });
  await mkdir(overlayDir);
  await writeFile(join(agentDir, "settings.json"), "{}");
  await writeFile(join(agentDir, "git", "package.txt"), "installed");

  await linkOverlay(agentDir, "/worktree", overlayDir);

  expect(await readlink(join(overlayDir, "skills"))).toBe("/worktree/shared/skills");
  expect(await readlink(join(overlayDir, "extensions"))).toBe("/worktree/pi/agent/extensions");
  expect(await readlink(join(overlayDir, "AGENTS.md"))).toBe("/worktree/shared/AGENTS.md");
  expect(await readlink(join(overlayDir, "settings.json"))).toBe(join(agentDir, "settings.json"));
  expect(await readlink(join(overlayDir, "git"))).toBe(join(agentDir, "git"));

  await rm(overlayDir, { recursive: true, force: true });
  expect(existsSync(join(agentDir, "git", "package.txt"))).toBe(true);
});
