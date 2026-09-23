/**
 * Offline lifecycle tests for probes/run.ts. Each test runs the real runner as a subprocess in a
 * temporary copy of the repository, with `pi` replaced by fake-pi.ts, so no model is called and
 * the committed probes/results directory is never touched.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ResultRecord } from "../lib/types.ts";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCENARIO = "stop-destructive";
const TEST_TIMEOUT_MS = 30_000;

type Sandbox = {
  root: string;
  temp: string;
  log: string;
  pidFile: string;
  env: Record<string, string>;
};

let sandbox: Sandbox;

function copyFromSource(relativePath: string, root: string): void {
  cpSync(join(SOURCE_ROOT, relativePath), join(root, relativePath), { recursive: true });
}

function createSandbox(): Sandbox {
  const base = mkdtempSync(join(tmpdir(), "probe-runner-test-"));
  const root = join(base, "repo");
  const temp = join(base, "tmp");
  const bin = join(base, "bin");
  const agentDir = join(base, "agent");
  const packageDir = join(base, "plugins", "demo-pkg");
  for (const dir of [root, temp, bin, agentDir, packageDir]) mkdirSync(dir, { recursive: true });

  copyFromSource("probes", root);
  rmSync(join(root, "probes/results"), { recursive: true, force: true });
  mkdirSync(join(root, "probes/results"));
  for (const path of ["pi/agent/extensions/sandbox", "pi/agent/extensions/verify-turn", "shared/AGENTS.md", "pi/agent/packages.txt"]) {
    copyFromSource(path, root);
  }
  for (const dir of ["pi/agent/agents", "pi/agent/prompts", "shared/skills"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "pi/agent/mcp.json"), "{}\n");

  // Whole mode requires the installed resource links to point at this checkout.
  for (const [installed, canonical] of [
    ["agents", "pi/agent/agents"],
    ["extensions", "pi/agent/extensions"],
    ["prompts", "pi/agent/prompts"],
    ["skills", "shared/skills"],
    ["mcp.json", "pi/agent/mcp.json"],
  ]) symlinkSync(join(root, canonical), join(agentDir, installed));
  writeFileSync(join(packageDir, "package.json"), "{\"name\":\"demo-pkg\",\"version\":\"1.2.3\"}\n");
  writeFileSync(join(packageDir, "index.ts"), "export {};\n");

  writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec bun "${join(SOURCE_ROOT, "probes/test/fake-pi.ts")}" "$@"\n`, { mode: 0o755 });

  const log = join(base, "calls.log");
  const pidFile = join(base, "grandchild.pid");
  return {
    root,
    temp,
    log,
    pidFile,
    env: {
      ...(process.env as Record<string, string>),
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: temp,
      PI_CODING_AGENT_DIR: agentDir,
      PI_PROBE_AGENT_TIMEOUT_MS: "1500",
      PI_PROBE_JUDGE_TIMEOUT_MS: "1500",
      PI_PROBE_KILL_GRACE_MS: "300",
      FAKE_LOG: log,
      FAKE_PIDFILE: pidFile,
      FAKE_MARK: join(base, "mark"),
      FAKE_PACKAGE: packageDir,
    },
  };
}

function startRunner(args: string[], env: Record<string, string> = {}) {
  return Bun.spawn(["bun", join(sandbox.root, "probes/run.ts"), "--scenario", SCENARIO, ...args], {
    cwd: sandbox.root,
    env: { ...sandbox.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function runRunner(args: string[], env: Record<string, string> = {}) {
  const proc = startRunner(args, env);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function resultFiles(): string[] {
  return readdirSync(join(sandbox.root, "probes/results"));
}

function recordFor(model: string): ResultRecord {
  const name = resultFiles().find((file) => file.includes(`__${model.replace("/", "-")}__`) && file.endsWith(".json"));
  if (!name) throw new Error(`no record for ${model}: ${resultFiles().join(", ")}`);
  return JSON.parse(readFileSync(join(sandbox.root, "probes/results", name), "utf8")) as ResultRecord;
}

function lockFiles(): string[] {
  return resultFiles().filter((file) => file.endsWith(".lock") || file.endsWith(".tmp"));
}

function probeTempDirs(): string[] {
  return readdirSync(sandbox.temp).filter((name) => name.startsWith("pi-probe-"));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(25);
  }
}

function calls(): string[] {
  return existsSync(sandbox.log) ? readFileSync(sandbox.log, "utf8").trim().split("\n") : [];
}

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  if (existsSync(sandbox.pidFile)) {
    const pid = Number(readFileSync(sandbox.pidFile, "utf8"));
    if (isAlive(pid)) process.kill(pid, "SIGKILL");
  }
  rmSync(dirname(sandbox.root), { recursive: true, force: true });
});

describe("probe runner lifecycle", () => {
  test("scores completed trials, pins thinking, guards installs, and cleans up", async () => {
    const result = await runRunner(["--models", "fake/ok", "--trials", "2"]);
    expect(result.exitCode).toBe(0);
    const record = recordFor("fake/ok");
    expect(record.trials.map((trial) => trial.trial)).toEqual([1, 2]);
    expect(record.trials[0].bashExecutions).toEqual([{ command: "bun test test/charge.test.ts", exitCode: 0 }]);
    expect(record.infrastructureFailures).toEqual([]);
    expect(record.runtime).toEqual({ piVersion: "0.0.0-fake", bunVersion: Bun.version });
    expect(calls()).toEqual([
      "agent thinking=medium registry=http://127.0.0.1:9/",
      "judge thinking=medium registry=unset",
      "agent thinking=medium registry=http://127.0.0.1:9/",
      "judge thinking=medium registry=unset",
    ]);
    expect(lockFiles()).toEqual([]);
    expect(probeTempDirs()).toEqual([]);
  }, TEST_TIMEOUT_MS);

  for (const [mode, reason] of [
    ["exit", /pi exited 3: provider auth failed/],
    ["incomplete", /pi run incomplete: final assistant request ended with error/],
    ["hang", /pi timed out after 1\.5s/],
  ] as const) {
    test(`records an agent that ends with ${mode} as an infrastructure failure`, async () => {
      const result = await runRunner(["--models", `fake/${mode}`, "--trials", "1"], { FAKE_MODE: mode });
      expect(result.exitCode).toBe(1);
      const record = recordFor(`fake/${mode}`);
      expect(record.trials).toEqual([]);
      expect(record.infrastructureFailures).toHaveLength(1);
      expect(record.infrastructureFailures[0].reason).toMatch(reason);
      expect(calls().filter((line) => line.startsWith("judge"))).toEqual([]);
      expect(lockFiles()).toEqual([]);
      expect(probeTempDirs()).toEqual([]);
    }, TEST_TIMEOUT_MS);
  }

  test("keeps the paid trial when the judge fails, exits non-zero until it is re-judged from stored evidence", async () => {
    const result = await runRunner(["--models", "fake/judge", "--trials", "1"], { FAKE_JUDGE: "exit" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("judge pass 0 fail 0 unparsed 0 unavailable 1");
    const record = recordFor("fake/judge");
    expect(record.trials).toHaveLength(1);
    expect(record.trials[0].judge).toEqual({ verdict: "unavailable", reason: "pi exited 2: judge provider down" });
    expect(record.trials[0].judgeEvidence).toContain("bun test test/charge.test.ts exited 0");
    expect(record.infrastructureFailures).toEqual([]);

    const dry = await runRunner(["--models", "fake/judge", "--trials", "1", "--dry-run"]);
    expect(dry.stdout).toContain("| cached, would re-judge 1 |");

    const stillDown = await runRunner(["--models", "fake/judge", "--trials", "1"], { FAKE_JUDGE: "exit" });
    expect(stillDown.exitCode).toBe(1);
    expect(stillDown.stdout).toContain("1 stored trial(s) have no judge verdict");

    rmSync(sandbox.log, { force: true });
    const recovered = await runRunner(["--models", "fake/judge", "--trials", "1"]);
    expect(recovered.exitCode).toBe(0);
    expect(recovered.stdout).toContain("| cached, re-judged 1 |");
    expect(calls()).toEqual(["judge thinking=medium registry=unset"]);
    expect(recordFor("fake/judge").trials[0].judge.verdict).toBe("pass");
  }, TEST_TIMEOUT_MS);

  test("kills a detached grandchild when the agent ignores SIGTERM", async () => {
    const result = await runRunner(["--models", "fake/stubborn", "--trials", "1"], { FAKE_MODE: "ignore-term" });
    expect(result.exitCode).toBe(1);
    const grandchild = Number(readFileSync(sandbox.pidFile, "utf8"));
    await waitFor(() => !isAlive(grandchild), 2_000);
  }, TEST_TIMEOUT_MS);

  test("an interruption keeps completed trials and records nothing for the interrupted one", async () => {
    const runner = startRunner(["--models", "fake/int", "--trials", "3"], { FAKE_MODE: "slow-after-first" });
    await waitFor(() => calls().filter((line) => line.startsWith("agent")).length === 2);
    runner.kill("SIGINT");
    expect(await runner.exited).toBe(130);
    const record = recordFor("fake/int");
    expect(record.trials).toHaveLength(1);
    expect(record.infrastructureFailures).toEqual([]);
    expect(lockFiles()).toEqual([]);
    expect(probeTempDirs()).toEqual([]);
    await waitFor(() => !isAlive(Number(readFileSync(sandbox.pidFile, "utf8"))), 2_000);
  }, TEST_TIMEOUT_MS);

  test("a concurrent runner skips a locked record instead of duplicating trials", async () => {
    const holder = startRunner(["--models", "fake/shared", "--trials", "1"], { FAKE_MODE: "hang" });
    await waitFor(() => resultFiles().some((file) => file.endsWith(".lock")));
    const second = await runRunner(["--models", "fake/shared", "--trials", "1"]);
    expect(second.stdout).toContain(`skipped: locked by pid ${holder.pid} on ${hostname()}`);
    expect(await holder.exited).toBe(1);
    const after = await runRunner(["--models", "fake/shared", "--trials", "1"]);
    expect(after.exitCode).toBe(0);
    const record = recordFor("fake/shared");
    expect(record.trials).toHaveLength(1);
    expect(record.infrastructureFailures).toHaveLength(1);
  }, TEST_TIMEOUT_MS);

  test("reclaims a lock whose local owner is dead but respects one held on another host", async () => {
    await runRunner(["--models", "fake/lock", "--trials", "1"]);
    const recordName = resultFiles().find((file) => file.endsWith(".json"))!;
    const lock = join(sandbox.root, "probes/results", `${recordName}.lock`);

    writeFileSync(lock, JSON.stringify({ pid: 999_999, host: hostname(), startedAt: "then" }));
    const reclaimed = await runRunner(["--models", "fake/lock", "--trials", "2"]);
    expect(reclaimed.stdout).toContain("topped up +1");
    expect(existsSync(lock)).toBe(false);

    writeFileSync(lock, JSON.stringify({ pid: 999_999, host: "elsewhere", startedAt: "then" }));
    const respected = await runRunner(["--models", "fake/lock", "--trials", "3"]);
    expect(respected.stdout).toContain("skipped: locked by pid 999999 on elsewhere");
    expect(existsSync(lock)).toBe(true);
    expect(recordFor("fake/lock").trials).toHaveLength(2);
  }, TEST_TIMEOUT_MS);

  test("two runners reclaiming the same dead lock at once buy only one trial", async () => {
    // An agent failure creates the record file without a trial, so the next runs have one to buy.
    expect((await runRunner(["--models", "fake/race", "--trials", "1"], { FAKE_MODE: "exit" })).exitCode).toBe(1);
    const recordName = resultFiles().find((file) => file.endsWith(".json"))!;
    const lock = join(sandbox.root, "probes/results", `${recordName}.lock`);
    writeFileSync(lock, JSON.stringify({ pid: 999_999, host: hostname(), startedAt: "then" }));
    rmSync(sandbox.log, { force: true });

    const results = await Promise.all([
      runRunner(["--models", "fake/race", "--trials", "1"]),
      runRunner(["--models", "fake/race", "--trials", "1"]),
    ]);
    expect(results.map((result) => result.exitCode)).toEqual([0, 0]);
    expect(calls().filter((line) => line.startsWith("agent"))).toHaveLength(1);
    expect(recordFor("fake/race").trials).toHaveLength(1);
    expect(lockFiles()).toEqual([]);
  }, TEST_TIMEOUT_MS);

  test("a fixture whose check fails before the run aborts without leaking locks or directories", async () => {
    writeFileSync(
      join(sandbox.root, "probes/scenarios", SCENARIO, "fixture/test/charge.test.ts"),
      "import { expect, test } from \"bun:test\";\ntest(\"broken\", () => expect(1).toBe(2));\n",
    );
    const result = await runRunner(["--models", "fake/broken", "--trials", "1"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("fixture check must pass before the run");
    expect(calls()).toEqual([]);
    expect(lockFiles()).toEqual([]);
    expect(probeTempDirs()).toEqual([]);
  }, TEST_TIMEOUT_MS);

  test("whole mode keys on a sanitized runtime identity", async () => {
    const result = await runRunner(["--harness-mode", "whole", "--models", "fake/whole", "--trials", "1"]);
    expect(result.exitCode).toBe(0);
    const record = recordFor("fake/whole");
    expect(record.runtimeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.runtime.packages).toEqual([
      { source: "local:demo-pkg", name: "demo-pkg", version: "1.2.3", contentHash: expect.stringMatching(/^[0-9a-f]{16}$/) },
    ]);
    expect(JSON.stringify(record)).not.toContain(dirname(sandbox.root));

    const harnessLine = (stdout: string) => stdout.split("\n").find((line) => line.startsWith("harness mode:"));
    const dryRun = ["--harness-mode", "whole", "--models", "fake/whole", "--trials", "1", "--dry-run"];
    const before = await runRunner(dryRun);
    appendFileSync(join(sandbox.root, "pi/agent/packages.txt"), "\n# a comment-only edit\n\n");
    const commented = await runRunner(dryRun);
    expect(harnessLine(commented.stdout)).toBe(harnessLine(before.stdout));
    expect(commented.stdout).toContain("| cached |");

    appendFileSync(join(sandbox.env.FAKE_PACKAGE, "index.ts"), "export const changed = true;\n");
    const changed = await runRunner(dryRun);
    expect(changed.stdout).toContain("would run 1 trials");
  }, TEST_TIMEOUT_MS);
});
