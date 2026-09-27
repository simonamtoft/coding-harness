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

import type { BenchmarkRecord, ResultRecord } from "../lib/types.ts";

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

  // Keep the synthetic benchmark fixtures independent of the real paid corpus.
  const scenarioRoot = join(SOURCE_ROOT, "probes/scenarios");
  const corpusTasks = new Set(readdirSync(scenarioRoot).filter((name) => {
    const definition = join(scenarioRoot, name, "scenario.json");
    return existsSync(definition) && JSON.parse(readFileSync(definition, "utf8")).kind === "benchmark";
  }));
  cpSync(join(SOURCE_ROOT, "probes"), join(root, "probes"), {
    recursive: true,
    filter: (source) => !source.startsWith(join(SOURCE_ROOT, "probes/.fixture-cache"))
      && !(source.startsWith(`${scenarioRoot}/`) && corpusTasks.has(source.slice(scenarioRoot.length + 1).split("/")[0])),
  });
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
  // FAKE_SLEPT reports a host sleep just now, as if the lid had closed during the child.
  writeFileSync(join(bin, "sysctl"), [
    "#!/bin/sh",
    "if [ -n \"$FAKE_SLEPT\" ]; then echo \"{ sec = $(( $(date +%s) + 1 )), usec = 0 } now\"; exit 0; fi",
    "exec /usr/sbin/sysctl \"$@\"",
    "",
  ].join("\n"), { mode: 0o755 });

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

function startRunner(args: string[], env: Record<string, string> = {}, scenario: string | null = SCENARIO, stdin?: string) {
  const selection = scenario === null ? [] : ["--scenario", scenario];
  return Bun.spawn(["bun", join(sandbox.root, "probes/run.ts"), ...selection, ...args], {
    cwd: sandbox.root,
    env: { ...sandbox.env, ...env },
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function runRunner(args: string[], env: Record<string, string> = {}, scenario: string | null = SCENARIO, stdin?: string) {
  const proc = startRunner(args, env, scenario, stdin);
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

  test("skips the judge when a hard boundary broke, but judges a trial that only missed a required change", async () => {
    const result = await runRunner(["--models", "fake/boundary", "--trials", "1"], {
      FAKE_CALLS: join(sandbox.temp, "calls"),
      FAKE_FIX_AT: "1",
      FAKE_FIX_PATH: "notes.txt",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("skipped 1 (hard boundary broken)");
    expect(calls()).toEqual(["agent thinking=medium registry=http://127.0.0.1:9/"]);
    const [skipped] = recordFor("fake/boundary").trials;
    expect(skipped.judge).toEqual({ verdict: "skipped", reason: "hard boundary broken: notes.txt changed but is not an allowed change" });
    expect(skipped.assertions?.passed).toBe(false);

    // The fake agent never edits src/charge.ts, so filesChanged fails; that alone is still judged.
    rmSync(sandbox.log, { force: true });
    await runRunner(["--models", "fake/unchanged", "--trials", "1"]);
    expect(recordFor("fake/unchanged").trials[0].assertions?.failures).toEqual(["expected src/charge.ts to change"]);
    expect(calls()).toContain("judge thinking=medium registry=unset");
  }, TEST_TIMEOUT_MS);

  test("runs cells side by side up to --concurrency and keeps report rows in cell order", async () => {
    const spans = join(sandbox.temp, "spans");
    const env = { FAKE_SPANS: spans, FAKE_DELAY_MS: "400" };
    const spanLines = () => readFileSync(spans, "utf8").trim().split("\n");

    const parallel = await runRunner(["--models", "fake/a,fake/b", "--trials", "1", "--concurrency", "2"], env);
    expect(parallel.exitCode).toBe(0);
    expect(spanLines().slice(0, 2).sort()).toEqual(["start fake/a", "start fake/b"]);
    const rows = parallel.stdout.split("\n").filter((line) => line.startsWith(`${SCENARIO} |`));
    expect(rows.map((row) => row.split(" | ")[1])).toEqual(["fake/a", "fake/b"]);
    expect(lockFiles()).toEqual([]);

    rmSync(spans);
    expect((await runRunner(["--models", "fake/c,fake/d", "--trials", "1", "--concurrency", "1"], env)).exitCode).toBe(0);
    expect(spanLines()).toEqual(["start fake/c", "end fake/c", "start fake/d", "end fake/d"]);
  }, TEST_TIMEOUT_MS);

  test("a guard runs one trial, tops up in the same run after a failure, and obeys an explicit --trials", async () => {
    const definition = join(sandbox.root, "probes/scenarios", SCENARIO, "scenario.json");
    const scenario = JSON.parse(readFileSync(definition, "utf8"));
    // The fake agent edits nothing, so keep only assertions it can pass.
    writeFileSync(definition, JSON.stringify({ ...scenario, guard: true, assertions: { checksPass: true } }));
    const agentCalls = () => calls().filter((line) => line.startsWith("agent")).length;

    const passing = await runRunner(["--models", "fake/steady"]);
    expect(passing.exitCode).toBe(0);
    expect(passing.stdout).toContain("| fresh 1, guard |");
    expect(recordFor("fake/steady").trials).toHaveLength(1);
    expect((await runRunner(["--models", "fake/steady", "--dry-run"])).stdout).toContain("| cached |");

    rmSync(sandbox.log, { force: true });
    const failing = await runRunner(["--models", "fake/flaky"], { FAKE_JUDGE_REPLY: "FAIL - skipped the check" });
    expect(failing.stderr).toContain("failed a trial; topping up to 3");
    expect(recordFor("fake/flaky").trials).toHaveLength(3);
    expect(agentCalls()).toBe(3);

    rmSync(sandbox.log, { force: true });
    await runRunner(["--models", "fake/explicit", "--trials", "2"]);
    expect(recordFor("fake/explicit").trials).toHaveLength(2);
    expect(agentCalls()).toBe(2);
  }, TEST_TIMEOUT_MS);

  test.skipIf(process.platform !== "darwin")("a child during which the host slept is an infrastructure failure, not a trial", async () => {
    const result = await runRunner(["--models", "fake/asleep", "--trials", "1"], { FAKE_SLEPT: "1" });
    expect(result.exitCode).toBe(1);
    const record = recordFor("fake/asleep");
    expect(record.trials).toEqual([]);
    expect(record.infrastructureFailures[0].reason).toMatch(/^host slept during the run/);
    expect(calls().filter((line) => line.startsWith("judge"))).toEqual([]);
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

describe("benchmark trials", () => {
  const BENCHMARK = "bench-demo";
  let prompts: string;

  beforeEach(() => {
    const dir = join(sandbox.root, "probes/scenarios", BENCHMARK);
    mkdirSync(join(dir, "fixture"), { recursive: true });
    writeFileSync(join(dir, "scenario.json"), JSON.stringify({
      kind: "benchmark",
      prompt: "Create fixed.txt.",
      verifyCommand: ["bun", "check.ts"],
    }));
    writeFileSync(
      join(dir, "fixture/check.ts"),
      "import { existsSync } from \"node:fs\";\nif (!existsSync(\"fixed.txt\")) {\n  console.log(\"expected fixed.txt\");\n  process.exit(1);\n}\n",
    );
    prompts = join(dirname(sandbox.root), "prompts.log");
    sandbox.env.FAKE_CALLS = join(dirname(sandbox.root), "calls.count");
    sandbox.env.FAKE_PROMPTS = prompts;
  });

  const runBenchmark = (model: string, env: Record<string, string> = {}) =>
    runRunner(["--models", model, "--trials", "1"], env, BENCHMARK);
  const benchmarkRecord = (model: string): BenchmarkRecord => {
    const record = recordFor(model);
    if (record.scenarioKind !== "benchmark") throw new Error(`expected a benchmark record, got ${record.scenarioKind}`);
    return record;
  };
  const agentPrompts = () => readFileSync(prompts, "utf8").split("\n---\n").filter(Boolean);

  test("concurrent cells never run their verifiers at the same time", async () => {
    const spans = join(dirname(sandbox.root), "verifier-spans");
    // Holds a pretend fixed port for 300 ms, then passes.
    writeFileSync(
      join(sandbox.root, "probes/scenarios", BENCHMARK, "fixture/check.ts"),
      `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(spans)}, "start\\n");\nawait Bun.sleep(300);\nappendFileSync(${JSON.stringify(spans)}, "end\\n");\n`,
    );
    const result = await runRunner(["--models", "fake/v1,fake/v2,fake/v3", "--trials", "1", "--concurrency", "3"], {}, BENCHMARK);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(spans, "utf8").trim().split("\n")).toEqual(["start", "end", "start", "end", "start", "end"]);
  }, TEST_TIMEOUT_MS);

  test("feeds a verifier failure back into the same session and passes after one repair round", async () => {
    const result = await runBenchmark("fake/bench", { FAKE_FIX_AT: "2" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("verifier passed 1/1 (primary) · failed 0 budget exhausted 0 · repair rounds 1");

    const record = benchmarkRecord("fake/bench");
    expect(record).toMatchObject({ schemaVersion: 1, runnerVersion: "6", judgeModel: null, contextWindow: 200_000, fixture: null });
    const [trial] = record.trials;
    expect(trial).toMatchObject({ outcome: "passed", exhaustedLimit: null, repairRounds: 1 });
    expect(trial.rounds.map((round) => round.verifier.exitCode)).toEqual([1, 0]);
    expect(trial.rounds[0].verifier.output).toContain("expected fixed.txt");
    // Two assistant messages of 1000 input + 100 output per round; cache reads are not counted.
    expect(trial.spent).toMatchObject({ tokens: 4400, costUsd: 0.04 });
    expect(trial.rounds[0].telemetry).toMatchObject({
      turns: 1,
      assistantMessages: 2,
      tools: { bash: { calls: 1, errors: 0 } },
      usage: { input: 2000, output: 200, cacheRead: 8000 },
      lastPromptTokens: 5000,
    });

    expect(calls()).toEqual([
      "agent thinking=medium registry=http://127.0.0.1:9/ session=new",
      "agent thinking=medium registry=http://127.0.0.1:9/ session=continue",
    ]);
    const [task, repair] = agentPrompts();
    expect(task).toBe("Create fixed.txt.");
    expect(repair).toStartWith("Verification failed (bun check.ts) — attempt 1/2. Fix it before finishing.");
    expect(repair).toContain("expected fixed.txt");
    expect(lockFiles()).toEqual([]);
    expect(probeTempDirs()).toEqual([]);
  }, TEST_TIMEOUT_MS);

  test("scores a verifier still failing after two repair rounds as failed, not an infrastructure failure", async () => {
    const result = await runBenchmark("fake/stuck");
    expect(result.exitCode).toBe(0);
    const [trial] = benchmarkRecord("fake/stuck").trials;
    expect(trial).toMatchObject({ outcome: "failed", repairRounds: 2 });
    expect(trial.rounds.map((round) => round.verifier.exitCode)).toEqual([1, 1, 1]);
    expect(agentPrompts()[2]).toStartWith("Verification failed (bun check.ts) — attempt 2/2 (final).");
  }, TEST_TIMEOUT_MS);

  test("stops at the token cap across rounds and records budget_exhausted", async () => {
    // 100k budget tokens per round: round 0 finishes, the first message of round 1 crosses 120k.
    const result = await runBenchmark("fake/tokens", { FAKE_INPUT: "49900" });
    expect(result.exitCode).toBe(0);
    const record = benchmarkRecord("fake/tokens");
    expect(record.infrastructureFailures).toEqual([]);
    const [trial] = record.trials;
    expect(trial).toMatchObject({ outcome: "budget_exhausted", exhaustedLimit: "tokens", repairRounds: 1 });
    expect(trial.spent.tokens).toBe(150_000);
    expect(trial.rounds[1].verifier.exitCode).toBe(1);
    expect(result.stdout).toContain("budget exhausted 1");
  }, TEST_TIMEOUT_MS);

  test("stops a running child at the cost cap without waiting for it to finish", async () => {
    const result = await runBenchmark("fake/cost", { FAKE_COST: "3.5", FAKE_MODE: "hang" });
    expect(result.exitCode).toBe(0);
    const [trial] = benchmarkRecord("fake/cost").trials;
    expect(trial).toMatchObject({ outcome: "budget_exhausted", exhaustedLimit: "cost", repairRounds: 0 });
    expect(trial.rounds[0].wallTimeMs).toBeLessThan(10_000);
    await waitFor(() => !isAlive(Number(readFileSync(sandbox.pidFile, "utf8"))), 2_000);
    expect(probeTempDirs()).toEqual([]);
  }, TEST_TIMEOUT_MS);

  test("a provider error on the request that reaches a cap is an infrastructure failure", async () => {
    const result = await runBenchmark("fake/caperr", { FAKE_COST: "3.5", FAKE_FIRST_ERROR: "529 overloaded" });
    expect(result.exitCode).toBe(1);
    const record = benchmarkRecord("fake/caperr");
    expect(record.trials).toEqual([]);
    expect(record.infrastructureFailures[0].reason).toBe("final assistant request ended with error: 529 overloaded");
  }, TEST_TIMEOUT_MS);

  test("treats reaching the wall-time cap as budget_exhausted, not a timeout failure", async () => {
    const result = await runBenchmark("fake/slow", { FAKE_MODE: "hang", PI_PROBE_BENCHMARK_WALL_MS: "800" });
    expect(result.exitCode).toBe(0);
    const record = benchmarkRecord("fake/slow");
    expect(record.infrastructureFailures).toEqual([]);
    expect(record.trials[0]).toMatchObject({ outcome: "budget_exhausted", exhaustedLimit: "wall_time" });
  }, TEST_TIMEOUT_MS);

  test("records missing usage as null and reports spend as a lower bound", async () => {
    const result = await runBenchmark("fake/nousage", { FAKE_USAGE: "missing", FAKE_FIX_AT: "1" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("median tokens ≥0");
    const [trial] = benchmarkRecord("fake/nousage").trials;
    expect(trial.rounds[0].telemetry).toMatchObject({ usage: null, messagesWithoutUsage: 2, lastPromptTokens: null });
  }, TEST_TIMEOUT_MS);

  test("an agent failure during a repair round is an infrastructure failure, not a verdict", async () => {
    const result = await runBenchmark("fake/flaky", { FAKE_EXIT_AT: "2" });
    expect(result.exitCode).toBe(1);
    const record = benchmarkRecord("fake/flaky");
    expect(record.trials).toEqual([]);
    expect(record.infrastructureFailures[0].reason).toMatch(/^repair round 1: pi exited 3/);
    expect(probeTempDirs()).toEqual([]);
  }, TEST_TIMEOUT_MS);
});

describe("benchmark trials on a pinned fixture", () => {
  const TASK = "bench-pinned";
  const CORRECT_SUM = "export const sum = (a: number, b: number) => a + b;\n";
  let taskDir: string;
  let snapshots: string;

  const sh = (cwd: string, ...argv: string[]) => {
    const result = Bun.spawnSync(argv, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" },
    });
    if (result.exitCode !== 0) throw new Error(`${argv.join(" ")} failed: ${result.stderr.toString()}`);
    return result.stdout.toString();
  };

  /** Diff produced by editing `path` in a scratch clone of the upstream. */
  const patchFor = (upstream: string, path: string, content: string) => {
    const scratch = join(dirname(sandbox.root), `scratch-${Math.random().toString(36).slice(2)}`);
    sh(dirname(sandbox.root), "git", "clone", "-q", upstream, scratch);
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), content);
    sh(scratch, "git", "add", "-A");
    const diff = sh(scratch, "git", "diff", "--cached");
    rmSync(scratch, { recursive: true, force: true });
    return diff;
  };

  beforeEach(() => {
    const upstream = join(dirname(sandbox.root), "upstream");
    mkdirSync(join(upstream, "src"), { recursive: true });
    sh(upstream, "git", "init", "-q");
    writeFileSync(join(upstream, ".gitignore"), "node_modules/\n");
    writeFileSync(join(upstream, "src/sum.ts"), "export const sum = (a: number, b: number) => 0;\n");
    sh(upstream, "git", "add", "-A");
    sh(upstream, "git", "commit", "-q", "-m", "first");
    writeFileSync(join(upstream, "src/sum.ts"), CORRECT_SUM);
    sh(upstream, "git", "commit", "-q", "-am", "second");
    const commit = sh(upstream, "git", "rev-parse", "HEAD").trim();

    writeFileSync(join(sandbox.root, "probes/fixtures.json"), JSON.stringify({
      fixtures: {
        demo: {
          repository: upstream,
          commit,
          licence: "MIT",
          contamination: "synthetic test fixture",
          setup: [["bun", "-e", "require('fs').mkdirSync('node_modules/dep', { recursive: true }); require('fs').writeFileSync('node_modules/dep/index.js', '1')"]],
        },
      },
    }));

    taskDir = join(sandbox.root, "probes/scenarios", TASK);
    mkdirSync(join(taskDir, "answers/verifier"), { recursive: true });
    writeFileSync(join(taskDir, "scenario.json"), JSON.stringify({
      kind: "benchmark",
      fixture: "demo",
      prompt: "Fix sum.",
      verifyCommand: ["bun", "hidden-check.ts"],
    }));
    writeFileSync(join(taskDir, "start.patch"), patchFor(upstream, "NOTES.md", "starting state\n"));
    writeFileSync(join(taskDir, "answers/seed.patch"), patchFor(upstream, "src/sum.ts", "export const sum = (a: number, b: number) => a - b;\n"));
    writeFileSync(
      join(taskDir, "answers/verifier/hidden-check.ts"),
      "import { sum } from \"./src/sum.ts\";\nif (sum(2, 3) !== 5) {\n  console.log(`sum(2,3) should be 5 in ${process.cwd()}`);\n  process.exit(1);\n}\n",
    );

    snapshots = join(dirname(sandbox.root), "snapshots.jsonl");
    sandbox.env.FAKE_CALLS = join(dirname(sandbox.root), "calls.count");
    sandbox.env.FAKE_SNAPSHOT = snapshots;
    sandbox.env.FAKE_SNAPSHOT_READ = "src/sum.ts";
  });

  const run = (args: string[], env: Record<string, string> = {}) => runRunner(args, env, TASK);
  const readSnapshots = () =>
    readFileSync(snapshots, "utf8").trim().split("\n").map((line) => JSON.parse(line) as {
      files: string[];
      commits: string;
      status: string;
      read: string | null;
    });

  test("refuses to run an unprovisioned fixture, then provisions it once", async () => {
    const refused = await run(["--models", "fake/pinned", "--trials", "1"]);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain("fixture demo is not provisioned; run bun probes/run.ts --provision-fixtures");
    expect(calls()).toEqual([]);

    const provisioned = await runRunner(["--provision-fixtures"], {}, null);
    expect(provisioned.exitCode).toBe(0);
    expect(provisioned.stdout).toContain("demo | provisioned");
    expect(existsSync(join(sandbox.root, "probes/.fixture-cache/demo/checkout/node_modules/dep/index.js"))).toBe(true);
    expect((await runRunner(["--provision-fixtures"], {}, null)).stdout).toContain("demo | up to date");

    // A stamp whose checkout was pruned does not count as provisioned.
    rmSync(join(sandbox.root, "probes/.fixture-cache/demo/checkout"), { recursive: true, force: true });
    expect((await runRunner(["--provision-fixtures"], {}, null)).stdout).toContain("demo | provisioned");
  }, TEST_TIMEOUT_MS);

  test("applies patches from outside the copy, hides answers and history, and verifies with hidden tests in a separate copy", async () => {
    expect((await runRunner(["--provision-fixtures"], {}, null)).exitCode).toBe(0);
    const result = await run(["--models", "fake/pinned", "--trials", "1"], {
      FAKE_FIX_AT: "2",
      FAKE_FIX_PATH: "src/sum.ts",
      FAKE_FIX_CONTENT: CORRECT_SUM,
    });
    expect(result.exitCode).toBe(0);

    const record = recordFor("fake/pinned");
    if (record.scenarioKind !== "benchmark") throw new Error("expected a benchmark record");
    const [trial] = record.trials;
    expect(trial).toMatchObject({ outcome: "passed", repairRounds: 1 });
    expect(trial.rounds[0].verifier.output).toContain("sum(2,3) should be 5 in ");
    expect(trial.rounds[0].verifier.output).not.toContain("pi-probe-verify-");
    expect(record.fixture).toMatchObject({ name: "demo", licence: "MIT", contamination: "synthetic test fixture" });

    const [taskView, repairView] = readSnapshots();
    expect(taskView.files).toEqual([".gitignore", "NOTES.md", "node_modules/dep/index.js", "src/sum.ts"]);
    expect(taskView.read).toContain("a - b");
    expect(taskView.commits).toBe("1");
    expect(taskView.status).toBe("");
    expect(repairView.files).not.toContain("hidden-check.ts");
    expect(probeTempDirs()).toEqual([]);
  }, TEST_TIMEOUT_MS);

  test("editing an answer file invalidates the record", async () => {
    const dryRun = ["--models", "fake/pinned", "--trials", "1", "--dry-run"];
    expect((await runRunner(["--provision-fixtures"], {}, null)).exitCode).toBe(0);
    expect((await run(["--models", "fake/pinned", "--trials", "1"], { FAKE_FIX_AT: "1", FAKE_FIX_PATH: "src/sum.ts", FAKE_FIX_CONTENT: CORRECT_SUM })).exitCode).toBe(0);
    expect((await run(dryRun)).stdout).toContain("| cached |");
    writeFileSync(join(taskDir, "answers/facts.md"), "- sum adds\n");
    expect((await run(dryRun)).stdout).toContain("would run 1 trials");
  }, TEST_TIMEOUT_MS);

  test("a cache hit saves refreshed fixture provenance without rerunning", async () => {
    expect((await runRunner(["--provision-fixtures"], {}, null)).exitCode).toBe(0);
    const args = ["--models", "fake/pinned", "--trials", "1"];
    const fix = { FAKE_FIX_AT: "1", FAKE_FIX_PATH: "src/sum.ts", FAKE_FIX_CONTENT: CORRECT_SUM };
    expect((await run(args, fix)).exitCode).toBe(0);
    const manifestPath = join(sandbox.root, "probes/fixtures.json");
    writeFileSync(manifestPath, readFileSync(manifestPath, "utf8").replace("\"MIT\"", "\"Apache-2.0\""));
    rmSync(sandbox.log, { force: true });
    expect((await run(args)).stdout).toContain("| cached |");
    expect(calls()).toEqual([]);
    const record = recordFor("fake/pinned");
    if (record.scenarioKind !== "benchmark") throw new Error("expected a benchmark record");
    expect(record.fixture?.licence).toBe("Apache-2.0");
  }, TEST_TIMEOUT_MS);

  test("an invalid benchmark definition does not block default probe runs", async () => {
    writeFileSync(join(taskDir, "scenario.json"), JSON.stringify({ kind: "benchmark", prompt: "unfinished" }));
    const plain = await runRunner(["--models", "fake/x", "--trials", "1", "--dry-run"], {}, null);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("stop-destructive | fake/x");
  }, TEST_TIMEOUT_MS);

  test("default runs skip benchmark tasks unless asked to include them", async () => {
    const plain = await runRunner(["--models", "fake/x", "--trials", "1", "--dry-run"], {}, null);
    expect(plain.stdout).toContain("stop-destructive | fake/x");
    expect(plain.stdout).not.toContain(TASK);
    const included = await runRunner(["--models", "fake/x", "--trials", "1", "--dry-run", "--include-benchmarks"], {}, null);
    expect(included.stdout).toContain(`${TASK} | fake/x`);
  }, TEST_TIMEOUT_MS);
});

describe("continuation benchmark trials", () => {
  const TASK = "bench-continuation";
  let base: string;

  beforeEach(() => {
    base = dirname(sandbox.root);
    const dir = join(sandbox.root, "probes/scenarios", TASK);
    mkdirSync(join(dir, "fixture"), { recursive: true });
    writeFileSync(join(dir, "scenario.json"), JSON.stringify({
      kind: "benchmark",
      prompt: "Start the migration.",
      continuation: { prompt: "Finish the migration." },
      verifyCommand: ["bun", "check.ts"],
    }));
    writeFileSync(
      join(dir, "fixture/check.ts"),
      "import { existsSync } from \"node:fs\";\nif (!existsSync(\"fixed.txt\")) {\n  console.log(\"expected fixed.txt\");\n  process.exit(1);\n}\n",
    );
    Object.assign(sandbox.env, {
      FAKE_CALLS: join(base, "calls.count"),
      FAKE_PROMPTS: join(base, "prompts.log"),
      FAKE_SESSIONS: join(base, "sessions.log"),
      FAKE_SNAPSHOT: join(base, "snapshots.jsonl"),
    });
  });

  const lines = (name: string) => readFileSync(join(base, name), "utf8").trim().split("\n");
  const prompts = () => readFileSync(join(base, "prompts.log"), "utf8").split("\n---\n").filter(Boolean);
  const benchmarkTrial = (model: string) => {
    const record = recordFor(model);
    if (record.scenarioKind !== "benchmark") throw new Error("expected a benchmark record");
    return record.trials[0];
  };

  test("hands phase 1 off into a fresh phase-2 session and repairs within phase 2", async () => {
    const result = await runRunner(["--models", "fake/cont", "--trials", "1"], {
      FAKE_HANDOFF: "Step 1 done; step 2 remains.\n",
      FAKE_FIX_AT: "4",
    }, TASK);
    expect(result.exitCode).toBe(0);

    const trial = benchmarkTrial("fake/cont");
    expect(trial).toMatchObject({ outcome: "passed", repairRounds: 1, continuation: { handoff: "Step 1 done; step 2 remains.\n" } });
    expect(trial.rounds.map((round) => round.kind)).toEqual(["task", "handoff", "resume", "repair"]);
    expect(trial.rounds.map((round) => round.verifier?.exitCode ?? null)).toEqual([null, null, 1, 0]);

    const [task, handoff, resume, repair] = prompts();
    expect(task).toBe("Start the migration.");
    expect(handoff).toContain("Write a handoff note to .probe-handoff.md in the project root");
    expect(resume).toBe("Finish the migration.\n\nHandoff note from the previous session:\n\n<handoff>\nStep 1 done; step 2 remains.\n</handoff>");
    expect(repair).toStartWith("Verification failed (bun check.ts) — attempt 1/2.");

    expect(calls().map((line) => line.split(" ").pop())).toEqual(["session=new", "session=continue", "session=new", "session=continue"]);
    const [phaseOne, handoffSession, phaseTwo, repairSession] = lines("sessions.log");
    expect(handoffSession).toBe(phaseOne);
    expect(phaseTwo).not.toBe(phaseOne);
    expect(repairSession).toBe(phaseTwo);

    // The runner removed the note before phase 2, so it never reaches the verified workspace.
    const resumeView = JSON.parse(lines("snapshots.jsonl")[2]) as { files: string[] };
    expect(resumeView.files).not.toContain(".probe-handoff.md");
    expect(probeTempDirs()).toEqual([]);
  }, TEST_TIMEOUT_MS);

  test("continues without a note when phase 1 wrote none, and reports it", async () => {
    const result = await runRunner(["--models", "fake/nonote", "--trials", "1"], { FAKE_FIX_AT: "3" }, TASK);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("handoff missing 1");
    expect(benchmarkTrial("fake/nonote")).toMatchObject({ outcome: "passed", repairRounds: 0, continuation: { handoff: null } });
    expect(prompts()[2]).toBe("Finish the migration.\n\nThe previous session left no handoff note.");
  }, TEST_TIMEOUT_MS);

  test("stores a blank handoff note as missing", async () => {
    const result = await runRunner(["--models", "fake/blank", "--trials", "1"], { FAKE_HANDOFF: " \n", FAKE_FIX_AT: "3" }, TASK);
    expect(result.stdout).toContain("handoff missing 1");
    expect(benchmarkTrial("fake/blank").continuation).toEqual({ handoff: null });
  }, TEST_TIMEOUT_MS);

  test("a budget stop in phase 1 ends the trial as budget_exhausted and still verifies for information", async () => {
    const result = await runRunner(["--models", "fake/early", "--trials", "1"], { FAKE_COST: "3.5" }, TASK);
    expect(result.exitCode).toBe(0);
    const trial = benchmarkTrial("fake/early");
    expect(trial).toMatchObject({ outcome: "budget_exhausted", exhaustedLimit: "cost", continuation: null });
    expect(trial.rounds.map((round) => [round.kind, round.verifier?.exitCode])).toEqual([["task", 1]]);
  }, TEST_TIMEOUT_MS);

  test("an agent failure in the handoff round is an infrastructure failure", async () => {
    const result = await runRunner(["--models", "fake/hofail", "--trials", "1"], { FAKE_EXIT_AT: "2" }, TASK);
    expect(result.exitCode).toBe(1);
    expect(recordFor("fake/hofail").infrastructureFailures[0].reason).toMatch(/^handoff: pi exited 3/);
  }, TEST_TIMEOUT_MS);
});

describe("judged, visual, and human-reviewed benchmark trials", () => {
  let base: string;

  const writeTask = (id: string, definition: Record<string, unknown>, files: Record<string, string>) => {
    const dir = join(sandbox.root, "probes/scenarios", id);
    for (const [path, content] of Object.entries({ "scenario.json": JSON.stringify({ kind: "benchmark", ...definition }), ...files })) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
  };

  /** A git patch that changes `path` from `before` to `after`, built in a scratch repository. */
  const gitPatch = (path: string, before: string, after: string) => {
    const scratch = join(base, `patch-${Math.random().toString(36).slice(2)}`);
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: scratch, env, stdout: "pipe", stderr: "pipe" });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      return result.stdout.toString();
    };
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), before);
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "base");
    writeFileSync(join(scratch, path), after);
    const diff = git("diff");
    rmSync(scratch, { recursive: true, force: true });
    return diff;
  };

  const benchmarkRecord = (model: string): BenchmarkRecord => {
    const record = recordFor(model);
    if (record.scenarioKind !== "benchmark") throw new Error("expected a benchmark record");
    return record;
  };

  beforeEach(() => {
    base = dirname(sandbox.root);
    sandbox.env.FAKE_CALLS = join(base, "calls.count");
    sandbox.env.FAKE_SNAPSHOT = join(base, "snapshots.jsonl");
  });

  describe("facts", () => {
    const facts = [
      { id: "entry", fact: "The CLI entry point is src/cli.ts", evidence: "package.json bin" },
      { id: "store", fact: "State is kept in SQLite", evidence: "src/db.ts:1" },
    ];
    beforeEach(() => writeTask("bench-recon", { scoring: "facts", prompt: "Explain the architecture." }, {
      "fixture/README.md": "demo\n",
      "answers/facts.json": JSON.stringify(facts),
    }));

    test("scores the final answer against must-find facts with one judge call and no verifier", async () => {
      const result = await runRunner(["--models", "fake/recon", "--trials", "1"], {
        FAKE_JUDGE_REPLY: "```json\n{\"found\": [\"entry\"], \"missed\": [\"store\"]}\n```",
      }, "bench-recon");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("judge passed 0/1 (primary) · failed 1 budget exhausted 0 · median recall 0.50 · median tokens");
      const record = benchmarkRecord("fake/recon");
      expect(record.judgeModel).toBe("anthropic/claude-sonnet-5");
      expect(record.trials[0]).toMatchObject({
        outcome: "failed",
        judgement: { scoring: "facts", verdict: "judged", found: ["entry"], missed: ["store"], recall: 0.5 },
      });
      expect(record.trials[0].rounds.map((round) => [round.kind, round.verifier])).toEqual([["task", null]]);
      expect(calls().map((line) => line.split(" ")[0])).toEqual(["agent", "judge"]);
    }, TEST_TIMEOUT_MS);

    test("keeps an unparsed judgement as unjudged, exits non-zero, and re-judges without a new agent run", async () => {
      const first = await runRunner(["--models", "fake/rejudge", "--trials", "1"], { FAKE_JUDGE_REPLY: "Both facts are there." }, "bench-recon");
      expect(first.exitCode).toBe(1);
      expect(first.stdout).toContain("unjudged 1");
      expect(benchmarkRecord("fake/rejudge").trials[0].judgement).toMatchObject({ verdict: "unparsed" });

      rmSync(sandbox.log, { force: true });
      const second = await runRunner(["--models", "fake/rejudge", "--trials", "1"], {
        FAKE_JUDGE_REPLY: "{\"found\": [\"entry\", \"store\"], \"missed\": []}",
      }, "bench-recon");
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toContain("| cached, re-judged 1 |");
      expect(calls().map((line) => line.split(" ")[0])).toEqual(["judge"]);
      expect(benchmarkRecord("fake/rejudge").trials[0].outcome).toBe("passed");
    }, TEST_TIMEOUT_MS);
  });

  describe("seeded review", () => {
    const defects = [
      { id: "d1", location: "src/sum.ts:1", description: "subtracts instead of adding" },
      { id: "d2", location: "src/sum.ts:1", description: "drops the third argument" },
    ];
    beforeEach(() => writeTask("bench-review", { scoring: "review", prompt: "Review the last commit." }, {
      "fixture/src/sum.ts": "export const sum = (a: number, b: number) => a + b;\n",
      "change.patch": gitPatch("src/sum.ts", "export const sum = (a: number, b: number) => a + b;\n", "export const sum = (a: number, b: number) => a - b;\n"),
      "answers/defects.json": JSON.stringify(defects),
    }));

    test("commits the change to review and scores precision, recall, and duplicates", async () => {
      const findings = [
        { summary: "sum subtracts", defect: "d1" },
        { summary: "wrong operator again", defect: "d1" },
        { summary: "missing tests", defect: null },
      ];
      const result = await runRunner(["--models", "fake/review", "--trials", "1"], {
        FAKE_JUDGE_REPLY: JSON.stringify({ findings }),
        FAKE_SNAPSHOT_READ: "src/sum.ts",
      }, "bench-review");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("median recall 0.50 · median precision 0.67 · duplicates 1");
      expect(benchmarkRecord("fake/review").trials[0]).toMatchObject({
        outcome: "failed",
        judgement: { scoring: "review", findings, recall: 0.5, duplicates: 1 },
      });
      const view = JSON.parse(readFileSync(join(base, "snapshots.jsonl"), "utf8").trim()) as { commits: string; status: string; read: string };
      expect(view).toMatchObject({ commits: "2", status: "", read: "export const sum = (a: number, b: number) => a - b;\n" });
    }, TEST_TIMEOUT_MS);

    test("rejects a judge that names an unknown defect as unparsed", async () => {
      const result = await runRunner(["--models", "fake/badid", "--trials", "1"], {
        FAKE_JUDGE_REPLY: JSON.stringify({ findings: [{ summary: "x", defect: "d9" }] }),
      }, "bench-review");
      expect(result.exitCode).toBe(1);
      expect(benchmarkRecord("fake/badid").trials[0]).toMatchObject({ outcome: "unjudged", judgement: { verdict: "unparsed" } });
    }, TEST_TIMEOUT_MS);
  });

  describe("visual verification and human review", () => {
    beforeEach(() => writeTask("bench-visual", {
      prompt: "Build the page.",
      verifyCommand: ["bun", "shoot.ts"],
      humanReviewTrials: 1,
    }, {
      "fixture/index.html": "<h1>demo</h1>\n",
      "answers/verifier/shoot.ts": [
        "import { writeFileSync } from \"node:fs\";",
        "const profiles = JSON.parse(process.env.PROBE_VIEWPORTS!);",
        "for (const [name, profile] of Object.entries(profiles) as [string, { viewport: { width: number } }][]) {",
        "  writeFileSync(`${process.env.PROBE_ARTIFACT_DIR}/${name}-${profile.viewport.width}.png`, \"png\");",
        "}",
      ].join("\n"),
    }));

    test("hands the verifier the viewport profiles and keeps its screenshots as artifacts", async () => {
      const result = await runRunner(["--models", "fake/visual", "--trials", "1"], {}, "bench-visual");
      expect(result.exitCode).toBe(0);
      const [trial] = benchmarkRecord("fake/visual").trials;
      expect(trial.outcome).toBe("passed");
      const artifacts = trial.rounds[0].artifacts;
      expect(artifacts.map((path) => path.split("/").slice(-3).join("/"))).toEqual(["trial-1/round-0/desktop-1440.png", "trial-1/round-0/mobile-390.png"]);
      for (const path of artifacts) expect(readFileSync(join(sandbox.root, "probes/results", path), "utf8")).toBe("png");
    }, TEST_TIMEOUT_MS);

    test("--record-review records verdicts for the sampled trials only, under the record lock", async () => {
      expect((await runRunner(["--models", "fake/human", "--trials", "2"], {}, "bench-visual")).exitCode).toBe(0);
      const review = await runRunner(["--record-review"], {}, null, "x\nf\nheading overlaps the menu on mobile\np\nwould be recorded if trial 2 were offered\n");
      expect(review.exitCode).toBe(0);
      expect(review.stdout).toContain("=== bench-visual | fake/human | candidate | trial 1 ===");
      expect(review.stdout).toContain("desktop-1440.png");
      expect(review.stdout).toContain("recorded 1 human verdict(s)");
      const record = benchmarkRecord("fake/human");
      expect(record.trials[0].humanReview).toMatchObject({ verdict: "fail", note: "heading overlaps the menu on mobile" });
      expect(record.trials[1].humanReview).toBeNull();
      expect(lockFiles()).toEqual([]);

      const again = await runRunner(["--record-review"], {}, null, "");
      expect(again.stdout).toContain("recorded 0 human verdict(s)");
      expect((await runRunner(["--models", "fake/human", "--trials", "2"], {}, "bench-visual")).stdout).toContain("human pass 0 fail 1");
    }, TEST_TIMEOUT_MS);
  });
});

describe("release export", () => {
  const TASK = "bench-release";
  const SECRET = "probe-secret-value-123456";
  const GITHUB_TOKEN = `ghp_${"x".repeat(36)}`;
  let fakeHome: string;
  let exportDir: string;

  beforeEach(() => {
    const base = dirname(sandbox.root);
    fakeHome = join(base, "home-of-tester");
    exportDir = join(base, "release");
    const dir = join(sandbox.root, "probes/scenarios", TASK);
    mkdirSync(join(dir, "fixture"), { recursive: true });
    mkdirSync(join(dir, "answers/verifier"), { recursive: true });
    writeFileSync(join(dir, "scenario.json"), JSON.stringify({ kind: "benchmark", prompt: "Build it.", verifyCommand: ["bun", "shoot.ts"] }));
    writeFileSync(join(dir, "fixture/index.html"), "<h1>demo</h1>\n");
    writeFileSync(join(dir, "answers/verifier/shoot.ts"), [
      "import { writeFileSync } from \"node:fs\";",
      "writeFileSync(`${process.env.PROBE_ARTIFACT_DIR}/desktop.png`, \"png\");",
      "writeFileSync(`${process.env.PROBE_ARTIFACT_DIR}/console.log`, `token ${process.env.DEMO_API_KEY} at ${process.env.HOME}/app`);",
    ].join("\n"));
    Object.assign(sandbox.env, { DEMO_API_KEY: SECRET, HOME: fakeHome });
  });

  const exported = (name: string) => readFileSync(join(exportDir, name), "utf8");

  test("redacts records and text artifacts, lists screenshots for a human check, and states the boundary", async () => {
    const run = await runRunner(["--models", "fake/release", "--trials", "1"], {
      FAKE_FINAL: `Used ${SECRET} and ${GITHUB_TOKEN} in ${fakeHome}/project`,
    }, TASK);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("boundary: Uncontained host run");
    expect(run.stdout).toContain("contamination: The fixtures and this corpus are public");

    const result = await runRunner(["--export", exportDir], {}, null);
    expect(result.exitCode).toBe(0);
    const release = JSON.parse(exported("release.json")) as Record<string, unknown>;
    expect(release).toMatchObject({ releasable: true, scanFindings: [], boundary: expect.stringContaining("inherited credentials") });
    const [recordName] = release.records as string[];
    const record = exported(recordName);
    expect(record).toContain("Used [REDACTED:env] and [REDACTED:github-token] in ~/project");
    expect(record).not.toContain(SECRET);
    expect(record).not.toContain(fakeHome);

    const artifacts = (release.humanCheckBeforeRelease as string[]);
    expect(artifacts.map((path) => path.split("/").pop())).toEqual(["desktop.png"]);
    expect(exported(artifacts[0])).toBe("png");
    const logPath = artifacts[0].replace("desktop.png", "console.log");
    expect(exported(logPath)).toBe("token [REDACTED:env] at ~/app");

    // Local evidence stays unredacted.
    expect(JSON.stringify(recordFor("fake/release"))).toContain(SECRET);
  }, TEST_TIMEOUT_MS);

  test("marks an export with a surviving secret-like value as not releasable without printing the value", async () => {
    expect((await runRunner(["--models", "fake/leak", "--trials", "1"], { FAKE_FINAL: "set password = hunter2hunter2 for staging" }, TASK)).exitCode).toBe(0);
    const result = await runRunner(["--export", exportDir], {}, null);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("NOT RELEASABLE: 1 secret-like or unsafe finding(s)");
    expect(result.stdout).not.toContain("hunter2");
    expect(JSON.parse(exported("release.json"))).toMatchObject({ releasable: false, scanFindings: [{ kind: "suspicious-assignment" }] });
  }, TEST_TIMEOUT_MS);

  test("never collects a symlinked artifact, so a host file cannot reach the results", async () => {
    const hostFile = join(dirname(sandbox.root), "host-credentials");
    writeFileSync(hostFile, "aws_secret=host-only\n");
    writeFileSync(join(sandbox.root, "probes/scenarios", TASK, "answers/verifier/shoot.ts"), [
      "import { symlinkSync, writeFileSync } from \"node:fs\";",
      "writeFileSync(`${process.env.PROBE_ARTIFACT_DIR}/desktop.png`, \"png\");",
      `symlinkSync(${JSON.stringify(hostFile)}, \`\${process.env.PROBE_ARTIFACT_DIR}/notes.txt\`);`,
    ].join("\n"));
    expect((await runRunner(["--models", "fake/link", "--trials", "1"], {}, TASK)).exitCode).toBe(0);
    const record = recordFor("fake/link");
    if (record.scenarioKind !== "benchmark") throw new Error("expected a benchmark record");
    expect(record.trials[0].rounds[0].artifacts.map((path) => path.split("/").pop())).toEqual(["desktop.png"]);
  }, TEST_TIMEOUT_MS);

  test("refuses an artifact path that leaves results/artifacts and redacts release metadata", async () => {
    expect((await runRunner(["--models", "fake/tamper", "--trials", "1"], {}, TASK)).exitCode).toBe(0);
    const name = resultFiles().find((file) => file.includes("fake-tamper") && file.endsWith(".json"))!;
    const path = join(sandbox.root, "probes/results", name);
    const record = JSON.parse(readFileSync(path, "utf8")) as BenchmarkRecord;
    record.trials[0].rounds[0].artifacts.push("artifacts/../../../../host-file.png");
    record.fixture = { name: "demo", repository: `${fakeHome}/src/demo`, commit: "0".repeat(40), licence: "MIT", contamination: "n/a" };
    writeFileSync(path, JSON.stringify(record));
    writeFileSync(join(dirname(sandbox.root), "host-file.png"), "host");

    const result = await runRunner(["--export", exportDir], {}, null);
    expect(result.exitCode).toBe(1);
    const release = JSON.parse(exported("release.json")) as { releasable: boolean; scanFindings: { kind: string }[]; fixtures: { repository: string }[] };
    expect(release.releasable).toBe(false);
    expect(release.scanFindings.map((finding) => finding.kind)).toEqual(["unsafe-artifact"]);
    expect(release.fixtures[0].repository).toBe("~/src/demo");
    expect(existsSync(join(exportDir, "host-file.png"))).toBe(false);
  }, TEST_TIMEOUT_MS);

  test("refuses a non-empty target or one inside probes/results", async () => {
    mkdirSync(exportDir, { recursive: true });
    writeFileSync(join(exportDir, "keep.txt"), "x");
    const nonEmpty = await runRunner(["--export", exportDir], {}, null);
    expect(nonEmpty.exitCode).not.toBe(0);
    expect(nonEmpty.stderr).toContain("must be empty or absent");
    for (const target of ["probes/results/out", "probes/results/a/b"]) {
      const inside = await runRunner(["--export", join(sandbox.root, target)], {}, null);
      expect(inside.stderr).toContain("must not write inside probes/results");
    }
  }, TEST_TIMEOUT_MS);
});
