#!/usr/bin/env bun
/**
 * Harness-behavior probe runner.
 *
 * Runs scenarios against one or more instruction variants and reports, per scenario
 * and model, how often the desired behavior occurred. Records are cached in
 * probes/results so an unchanged variant is never paid for twice.
 *
 * Every run makes paid model calls. Never wire this into automatic verification.
 */
import type { Subprocess } from "bun";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateAssertions } from "./lib/assertions.ts";
import { isReusable, measuresSameSetup, missingTrials, recordFileName, RUNNER_VERSION, type RecordKey } from "./lib/cache.ts";
import { hashFileSet, hashScenario, sha256Hex } from "./lib/hashing.ts";
import { judgePrompt, parseJudgeVerdict } from "./lib/judge.ts";
import type { LockOwner } from "./lib/lock.ts";
import { descendants, parseProcessTable, stillRunning, type ProcessEntry } from "./lib/processes.ts";
import { summarizeRecord } from "./lib/report.ts";
import { packageManifestEntries, parsePiList, runtimeFingerprint, sanitizePackageSource } from "./lib/runtime.ts";
import { parseScenario } from "./lib/scenario.ts";
import { parseProbeRun, type ProbeRun } from "./lib/transcript.ts";
import { acquireLock, releaseLock } from "./record-lock.ts";
import { automaticVerifierNotice } from "../pi/agent/extensions/verify-turn/notice.ts";
import type {
  BashExecution,
  HarnessMode,
  InfrastructureFailure,
  PackageIdentity,
  ResultRecord,
  RuntimeIdentity,
  Scenario,
  TrialRecord,
} from "./lib/types.ts";

const PROBES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PROBES_DIR, "..");
const SCENARIOS_DIR = join(PROBES_DIR, "scenarios");
const RESULTS_DIR = join(PROBES_DIR, "results");
const INSTRUCTIONS_PATH = "shared/AGENTS.md";
const PACKAGE_MANIFEST_PATH = "pi/agent/packages.txt";

const DEFAULT_MODELS = ["anthropic/claude-sonnet-5", "openai-codex/gpt-5.6-luna"];
const DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-5";
const DEFAULT_TRIALS = 3;
const SANDBOX_EXTENSION_PATH = "pi/agent/extensions/sandbox/index.ts";

/** Overrides exist so the offline lifecycle suite in probes/test can exercise timeouts quickly. */
function durationFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallbackMs;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive number of milliseconds`);
  return value;
}

const AGENT_TIMEOUT_MS = durationFromEnv("PI_PROBE_AGENT_TIMEOUT_MS", 20 * 60_000);
const JUDGE_TIMEOUT_MS = durationFromEnv("PI_PROBE_JUDGE_TIMEOUT_MS", 3 * 60_000);
const FIXTURE_COMMAND_TIMEOUT_MS = 2 * 60_000;
const METADATA_COMMAND_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = durationFromEnv("PI_PROBE_KILL_GRACE_MS", 5_000);
// Fixed for every child so local settings cannot change reasoning effort between records.
const THINKING_LEVEL = "medium";
// Points fixture agents' package managers at a closed port so an attempted install fails before
// downloading anything or editing a manifest. A scenario-safety guard, not network containment.
const CLOSED_REGISTRY = "http://127.0.0.1:9/";
const PACKAGE_INSTALL_GUARD_ENV = {
  npm_config_registry: CLOSED_REGISTRY, // npm, pnpm, Bun
  YARN_NPM_REGISTRY_SERVER: CLOSED_REGISTRY, // Yarn Berry
  YARN_REGISTRY: CLOSED_REGISTRY, // Yarn classic
  PIP_INDEX_URL: `${CLOSED_REGISTRY}simple`,
  PIP_NO_INDEX: "1",
  UV_OFFLINE: "1", // uv may still install from its local cache
  CARGO_NET_OFFLINE: "true",
  GOPROXY: "off",
} as const;

const EFFECTIVE_PI_HARNESS_DIRECTORIES = [
  "pi/agent/agents",
  "pi/agent/extensions",
  "pi/agent/prompts",
  "shared/skills",
] as const;
const EFFECTIVE_PI_HARNESS_FILES = ["pi/agent/mcp.json", PACKAGE_MANIFEST_PATH] as const;
const INSTALLED_PI_LINKS = [
  ["agents", "pi/agent/agents"],
  ["extensions", "pi/agent/extensions"],
  ["prompts", "pi/agent/prompts"],
  ["skills", "shared/skills"],
  ["mcp.json", "pi/agent/mcp.json"],
] as const;
const PACKAGE_HASH_EXCLUDED_NAMES = new Set([".git", "node_modules", ".DS_Store"]);

type Variant = { label: string; instructions: string; instructionsHash: string };

type Options = {
  compare: boolean;
  variantFiles: string[];
  models: string[];
  trials: number;
  scenarioIds: string[];
  judgeModel: string;
  harnessMode: HarnessMode;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    compare: false,
    variantFiles: [],
    models: DEFAULT_MODELS,
    trials: DEFAULT_TRIALS,
    scenarioIds: [],
    judgeModel: DEFAULT_JUDGE_MODEL,
    harnessMode: "isolated",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case "--compare": options.compare = true; break;
      case "--variant": options.variantFiles.push(next()); break;
      case "--models": options.models = next().split(",").map((m) => m.trim()).filter(Boolean); break;
      case "--trials": options.trials = Number(next()); break;
      case "--scenario": options.scenarioIds.push(next()); break;
      case "--judge-model": options.judgeModel = next(); break;
      case "--harness-mode": {
        const mode = next();
        if (mode !== "isolated" && mode !== "whole") {
          throw new Error("--harness-mode must be isolated or whole");
        }
        options.harnessMode = mode;
        break;
      }
      case "--dry-run": options.dryRun = true; break;
      case "--help": printUsage(); process.exit(0);
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.trials) || options.trials < 1) throw new Error("--trials must be a positive integer");
  return options;
}

function printUsage(): void {
  console.log(`Usage: bun probes/run.ts [options]

  --compare              Add the git HEAD version of ${INSTRUCTIONS_PATH} as a "baseline" variant
  --variant <path>       Additional instruction file to run (repeatable)
  --scenario <id>        Limit to a scenario (repeatable, default: all)
  --models <a,b>         Models under test (default: ${DEFAULT_MODELS.join(",")})
  --trials <n>           Trials per scenario/model/variant (default: ${DEFAULT_TRIALS})
  --judge-model <id>     Judge model (default: ${DEFAULT_JUDGE_MODEL})
  --harness-mode <mode>  isolated (default) or whole
  --dry-run              Report what would run and what is cached, without calling any model

The working tree ${INSTRUCTIONS_PATH} always runs as the "candidate" variant.`);
}

// ---------------------------------------------------------------------------
// Process and temporary-resource lifecycle. Everything created here is released on
// normal completion, on error, and on SIGINT/SIGTERM/SIGHUP.

const activeProcesses = new Set<Subprocess>();
const temporaryDirectories = new Set<string>();
const pendingRemovals = new Set<Promise<void>>();
const heldLocks = new Set<string>();

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

async function removeTemporaryDirectory(directory: string): Promise<void> {
  temporaryDirectories.delete(directory);
  const removal = rm(directory, { recursive: true, force: true });
  pendingRemovals.add(removal);
  try {
    await removal;
  } finally {
    pendingRemovals.delete(removal);
  }
}

function signalQuietly(target: number, signal: NodeJS.Signals): void {
  try {
    process.kill(target, signal);
  } catch {
    // The process or group has already exited.
  }
}

function processTable(): ProcessEntry[] {
  const ps = Bun.spawnSync(["ps", "-Ao", "pid=,ppid=,lstart="], { stdout: "pipe", stderr: "ignore" });
  return ps.exitCode === 0 ? parseProcessTable(ps.stdout.toString()) : [];
}

/**
 * Stops a detached child and its process group, escalating to SIGKILL after a grace period, then
 * kills surviving descendants. Pi detaches each Bash tool call into a group of its own, which a
 * signal to Pi's group does not reach, so descendants are recorded while Pi is still their parent.
 */
async function terminate(proc: Subprocess): Promise<void> {
  const tree = new Map(descendants(processTable(), proc.pid).map((entry) => [entry.pid, entry]));
  signalQuietly(-proc.pid, "SIGTERM");
  const exited = await Promise.race([proc.exited.then(() => true), Bun.sleep(KILL_GRACE_MS).then(() => false)]);
  if (!exited) {
    for (const entry of descendants(processTable(), proc.pid)) tree.set(entry.pid, entry);
    signalQuietly(-proc.pid, "SIGKILL");
  }
  await proc.exited;
  for (const { pid } of stillRunning([...tree.values()], processTable())) {
    signalQuietly(-pid, "SIGKILL");
    signalQuietly(pid, "SIGKILL");
  }
}

type BoundedResult = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean };

/**
 * Runs a child in its own process group so a timeout or interruption can stop the whole tree.
 */
async function runBounded(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  env: Record<string, string | undefined> = process.env,
): Promise<BoundedResult> {
  if (shuttingDown) throw new Error("probe run interrupted");
  const proc = Bun.spawn(argv, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
  activeProcesses.add(proc);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void terminate(proc);
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode: timedOut ? null : exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
    activeProcesses.delete(proc);
  }
}

async function releaseResources(): Promise<void> {
  await Promise.all([...activeProcesses].map(terminate));
  await Promise.all([...temporaryDirectories].map(removeTemporaryDirectory));
  // Removals already started by an unwinding trial must finish before the process exits.
  await Promise.allSettled([...pendingRemovals]);
  await Promise.all([...heldLocks].map(releaseRecordLock));
}

let shuttingDown = false;
for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`\n${signal}: stopping probe children; completed trials are already saved`);
    void releaseResources().finally(() => process.exit(exitCode));
  });
}

// ---------------------------------------------------------------------------
// Harness and runtime identity.

function isEffectiveHarnessFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (
    name === ".DS_Store" || name === "AGENTS.md" || name.startsWith("test_") ||
    path.includes("/__pycache__/") || path.includes("/tests/") || path.endsWith(".pyc")
  ) return false;
  if (path.startsWith("pi/agent/extensions/")) {
    return path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith(".guard-check.ts");
  }
  return true;
}

function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

async function verifyWholeHarnessLinks(): Promise<void> {
  const agentDir = piAgentDir();
  for (const [installedName, canonicalName] of INSTALLED_PI_LINKS) {
    const installed = join(agentDir, installedName);
    const canonical = join(REPO_ROOT, canonicalName);
    const [installedRealPath, canonicalRealPath] = await Promise.all([
      realpath(installed).catch(() => null),
      realpath(canonical),
    ]);
    if (installedRealPath !== canonicalRealPath) {
      throw new Error(`whole harness mode requires ${installed} to link to ${canonical}; run ./link.sh first`);
    }
  }
}

async function canonicalHarnessHash(directories: readonly string[], directFiles: readonly string[]): Promise<string> {
  const files = new Map<string, Uint8Array>();
  const addDirectory = async (relativeDir: string): Promise<void> => {
    const directory = join(REPO_ROOT, relativeDir);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = join(relativeDir, entry.name);
      if (entry.isDirectory()) await addDirectory(relativePath);
      else if (isEffectiveHarnessFile(relativePath)) files.set(relativePath, await readFile(join(REPO_ROOT, relativePath)));
    }
  };
  for (const directory of directories) await addDirectory(directory);
  for (const path of directFiles) {
    const content = await readFile(join(REPO_ROOT, path));
    // Only the listed sources matter; comment or whitespace edits must not invalidate records.
    files.set(path, path === PACKAGE_MANIFEST_PATH
      ? new TextEncoder().encode(packageManifestEntries(content.toString("utf8")).join("\n"))
      : content);
  }
  return hashFileSet(files);
}

function effectivePiHarnessHash(): Promise<string> {
  return canonicalHarnessHash(EFFECTIVE_PI_HARNESS_DIRECTORIES, EFFECTIVE_PI_HARNESS_FILES);
}

function isolatedHarnessHash(): Promise<string> {
  return canonicalHarnessHash(["pi/agent/extensions/sandbox"], []);
}

async function runMetadataCommand(argv: string[], cwd: string): Promise<string> {
  const result = await runBounded(argv, cwd, METADATA_COMMAND_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    throw new Error(`${argv.join(" ")} failed (${result.timedOut ? "timed out" : `exit ${result.exitCode}`}): ${result.stderr.trim().slice(0, 500)}`);
  }
  return result.stdout;
}

async function hashPackageContent(root: string): Promise<string> {
  const files = new Map<string, Uint8Array>();
  const add = async (path: string): Promise<void> => {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const name of await readdir(path)) {
        if (!PACKAGE_HASH_EXCLUDED_NAMES.has(name)) await add(join(path, name));
      }
    } else {
      files.set(relative(root, path) || basename(path), await readFile(path));
    }
  };
  await add(root);
  return hashFileSet(files);
}

async function packageIdentity(source: string, resolvedPath: string): Promise<PackageIdentity> {
  const manifest = await readFile(join(resolvedPath, "package.json"), "utf8")
    .then((text) => JSON.parse(text) as Record<string, unknown>, () => ({} as Record<string, unknown>));
  return {
    source: sanitizePackageSource(source),
    name: typeof manifest.name === "string" ? manifest.name : null,
    version: typeof manifest.version === "string" ? manifest.version : null,
    contentHash: (await hashPackageContent(resolvedPath)).slice(0, 16),
  };
}

async function readRuntimeIdentity(mode: HarnessMode): Promise<RuntimeIdentity> {
  const identity: RuntimeIdentity = {
    piVersion: (await runMetadataCommand(["pi", "--version"], REPO_ROOT)).trim(),
    bunVersion: Bun.version,
  };
  if (mode === "isolated") return identity;

  // Resolve packages from a directory without project settings, like a fixture copy.
  const listDir = await makeTemporaryDirectory("pi-probe-list-");
  try {
    const listed = parsePiList(await runMetadataCommand(["pi", "list"], listDir));
    identity.packages = await Promise.all(listed.map(({ source, resolvedPath }) => packageIdentity(source, resolvedPath)));
  } finally {
    await removeTemporaryDirectory(listDir);
  }
  return identity;
}

// ---------------------------------------------------------------------------
// Scenarios and variants.

async function readFixture(scenarioDir: string): Promise<Map<string, string>> {
  const fixtureDir = join(scenarioDir, "fixture");
  const files = new Map<string, string>();
  const exists = await stat(fixtureDir).then(() => true, () => false);
  if (!exists) return files;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.set(relative(fixtureDir, full), await readFile(full, "utf8"));
    }
  };
  await walk(fixtureDir);
  return files;
}

type LoadedScenario = { scenario: Scenario; dir: string; fixture: Map<string, string>; hash: string };

async function loadScenarios(ids: string[]): Promise<LoadedScenario[]> {
  const entries = await readdir(SCENARIOS_DIR, { withFileTypes: true });
  const loaded: LoadedScenario[] = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (ids.length > 0 && !ids.includes(entry.name)) continue;
    const dir = join(SCENARIOS_DIR, entry.name);
    const scenario = parseScenario(JSON.parse(await readFile(join(dir, "scenario.json"), "utf8")), entry.name);
    const fixture = await readFixture(dir);
    if (scenario.kind === "multi-turn" && fixture.size === 0) {
      throw new Error(`scenario ${entry.name}: multi-turn scenarios need a fixture/ directory`);
    }
    loaded.push({ scenario, dir, fixture, hash: hashScenario(scenario, fixture) });
  }
  if (loaded.length === 0) throw new Error("no scenarios matched");
  return loaded;
}

async function gitShowHead(path: string): Promise<string> {
  const proc = Bun.spawn(["git", "show", `HEAD:${path}`], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git show HEAD:${path} failed: ${err.trim()}`);
  return out;
}

async function resolveVariants(options: Options): Promise<Variant[]> {
  const variants: Variant[] = [];
  if (options.compare) {
    const instructions = await gitShowHead(INSTRUCTIONS_PATH);
    variants.push({ label: "baseline", instructions, instructionsHash: sha256Hex(instructions) });
  }
  for (const file of options.variantFiles) {
    const instructions = await readFile(file, "utf8");
    variants.push({
      label: file.replace(/^.*\//, "").replace(/\.md$/, ""),
      instructions,
      instructionsHash: sha256Hex(instructions),
    });
  }
  const candidate = await readFile(join(REPO_ROOT, INSTRUCTIONS_PATH), "utf8");
  variants.push({ label: "candidate", instructions: candidate, instructionsHash: sha256Hex(candidate) });

  const seen = new Set<string>();
  return variants.filter((variant) => {
    if (seen.has(variant.instructionsHash)) return false;
    seen.add(variant.instructionsHash);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Trials.

type PiOutcome = { kind: "completed"; run: ProbeRun } | { kind: "failed"; reason: string };

async function runPi(args: {
  model: string;
  systemPromptFile: string;
  prompt: string;
  cwd: string;
  withTools: boolean;
  harnessMode: HarnessMode;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
}): Promise<PiOutcome> {
  const argv = [
    "pi", "-p", "--mode", "json",
    "--model", args.model,
    "--thinking", THINKING_LEVEL,
    "--no-session",
    "--append-system-prompt", args.systemPromptFile,
  ];
  if (args.harnessMode === "isolated") {
    argv.push("--no-extensions", "--no-context-files", "--no-skills", "--no-prompt-templates");
    if (args.withTools) argv.push("--extension", join(REPO_ROOT, SANDBOX_EXTENSION_PATH));
  } else {
    // The complete shared instructions are appended as the selected variant, so do not discover them a second time.
    argv.push("--no-context-files");
  }
  if (!args.withTools) argv.push("--no-tools");
  argv.push("--", args.prompt);

  const result = await runBounded(argv, args.cwd, args.timeoutMs, args.env);
  const stderr = result.stderr.trim().slice(0, 500);
  if (result.timedOut) return { kind: "failed", reason: `pi timed out after ${args.timeoutMs / 1000}s` };
  if (result.exitCode !== 0) return { kind: "failed", reason: `pi exited ${result.exitCode}: ${stderr}` };
  const run = parseProbeRun(result.stdout);
  if (!run.completion.complete) return { kind: "failed", reason: `pi run incomplete: ${run.completion.reason}. ${stderr}`.trim() };
  return { kind: "completed", run };
}

async function runFixtureCommand(command: string[], cwd: string): Promise<{ exitCode: number | null; output: string }> {
  const result = await runBounded(command, cwd, FIXTURE_COMMAND_TIMEOUT_MS);
  const status = result.timedOut ? `\n(timed out after ${FIXTURE_COMMAND_TIMEOUT_MS / 1000}s)` : "";
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}`.trim() + status };
}

async function changedFixtureFiles(workDir: string, fixture: Map<string, string>): Promise<string[]> {
  const changed: string[] = [];
  for (const [path, original] of fixture) {
    const current = await readFile(join(workDir, path), "utf8").catch(() => null);
    if (current !== original) changed.push(path);
  }
  const listed = new Set(fixture.keys());
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const rel = relative(workDir, full);
        if (!listed.has(rel)) changed.push(rel);
      }
    }
  };
  await walk(workDir);
  return changed.sort();
}

function describeExecutions(executions: BashExecution[]): string {
  if (executions.length === 0) return "none";
  return executions
    .map(({ command, exitCode }) => `${command} → ${exitCode === null ? "did not run to an exit status" : `exit ${exitCode}`}`)
    .join(" | ");
}

type TrialOutcome =
  | { kind: "scored"; trial: Omit<TrialRecord, "trial"> }
  | { kind: "infrastructure"; failure: InfrastructureFailure };

function infrastructure(reason: string): TrialOutcome {
  return { kind: "infrastructure", failure: { reason, at: new Date().toISOString() } };
}

async function runTrial(args: {
  loaded: LoadedScenario;
  model: string;
  judgeModel: string;
  judgeSystemPromptFile: string;
  systemPromptFile: string;
  harnessMode: HarnessMode;
}): Promise<TrialOutcome> {
  const { loaded, model, judgeModel, judgeSystemPromptFile, systemPromptFile, harnessMode } = args;
  const { scenario } = loaded;

  if (scenario.kind === "single-turn") {
    const agent = await runPi({
      model, systemPromptFile, prompt: scenario.prompt, cwd: REPO_ROOT, withTools: false, harnessMode, timeoutMs: AGENT_TIMEOUT_MS,
    });
    if (agent.kind === "failed") return infrastructure(agent.reason);
    const verdict = await judge(scenario, agent.run.finalMessage, null, judgeModel, judgeSystemPromptFile);
    return {
      kind: "scored",
      trial: {
        assertions: null,
        judge: verdict,
        judgeEvidence: null,
        bashExecutions: agent.run.bashExecutions,
        finalMessage: agent.run.finalMessage,
      },
    };
  }

  const workDir = await makeTemporaryDirectory(`pi-probe-${scenario.id}-`);
  try {
    await cp(join(loaded.dir, "fixture"), workDir, { recursive: true });

    const before = await runFixtureCommand(scenario.checkCommand!, workDir);
    if (before.exitCode !== 0) {
      throw new Error(`scenario ${scenario.id}: fixture check must pass before the run\n${before.output}`);
    }

    const agent = await runPi({
      model,
      systemPromptFile,
      prompt: scenario.prompt,
      cwd: workDir,
      withTools: true,
      harnessMode,
      timeoutMs: AGENT_TIMEOUT_MS,
      env: { ...process.env, ...PACKAGE_INSTALL_GUARD_ENV },
    });
    if (agent.kind === "failed") return infrastructure(agent.reason);
    const { run } = agent;

    const after = await runFixtureCommand(scenario.checkCommand!, workDir);
    const assertions = evaluateAssertions(scenario.assertions ?? {}, {
      checkExitCode: after.exitCode,
      changedFiles: await changedFixtureFiles(workDir, loaded.fixture),
      bashExecutions: run.bashExecutions,
    });
    const reported = scenario.reportCommand ? await runFixtureCommand(scenario.reportCommand, workDir) : null;
    const checkEvidence = [
      `${scenario.checkCommand!.join(" ")} exited ${after.exitCode ?? "(timed out)"}:\n${after.output}`,
      reported ? `${scenario.reportCommand!.join(" ")} exited ${reported.exitCode ?? "(timed out)"}:\n${reported.output}` : null,
      `Bash commands the agent ran: ${describeExecutions(run.bashExecutions)}`,
    ].filter((part): part is string => part !== null).join("\n\n");
    const verdict = await judge(scenario, run.finalMessage, checkEvidence, judgeModel, judgeSystemPromptFile);
    return {
      kind: "scored",
      trial: { assertions, judge: verdict, judgeEvidence: checkEvidence, bashExecutions: run.bashExecutions, finalMessage: run.finalMessage },
    };
  } finally {
    await removeTemporaryDirectory(workDir);
  }
}

/**
 * The judge never sees an instruction variant; it scores behavior, not compliance wording.
 * A failed judge child yields an `unavailable` verdict, so the paid agent run and its
 * deterministic assertions are still kept.
 */
async function judge(
  scenario: Scenario,
  finalMessage: string,
  checkOutput: string | null,
  judgeModel: string,
  judgeSystemPromptFile: string,
): Promise<TrialRecord["judge"]> {
  const outcome = await runPi({
    model: judgeModel,
    systemPromptFile: judgeSystemPromptFile,
    prompt: judgePrompt(scenario, finalMessage, checkOutput),
    cwd: REPO_ROOT,
    withTools: false,
    harnessMode: "isolated",
    timeoutMs: JUDGE_TIMEOUT_MS,
  });
  if (outcome.kind === "failed") return { verdict: "unavailable", reason: outcome.reason.slice(0, 200) };
  return parseJudgeVerdict(outcome.run.finalMessage);
}

// ---------------------------------------------------------------------------
// Record persistence. One lock per record file serializes runners that share a cache key.

function lockPath(recordPath: string): string {
  return `${recordPath}.lock`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function unavailableJudgements(record: ResultRecord): number {
  return record.trials.filter((trial) => trial.judge.verdict === "unavailable").length;
}

const lockOwner: LockOwner = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };

/** Returns null when this runner now holds the lock, otherwise the live owner. */
async function acquireRecordLock(recordPath: string): Promise<LockOwner | null> {
  const holder = await acquireLock(lockPath(recordPath), lockOwner, isAlive);
  if (holder === null) heldLocks.add(recordPath);
  return holder;
}

async function releaseRecordLock(recordPath: string): Promise<void> {
  await releaseLock(lockPath(recordPath), lockOwner);
  // Forget the lock only once it is gone, so a signal arriving mid-release still releases it.
  heldLocks.delete(recordPath);
}

async function readRecord(path: string): Promise<ResultRecord | null> {
  return readFile(path, "utf8").then((text) => JSON.parse(text) as ResultRecord, () => null);
}

/** Replaces the record in one rename so an interruption leaves either the old or the new file. */
async function writeRecord(path: string, record: ResultRecord): Promise<void> {
  const staging = `${path}.${process.pid}.tmp`;
  await writeFile(staging, `${JSON.stringify(record, null, 2)}\n`);
  await rename(staging, path);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const scenarios = await loadScenarios(options.scenarioIds);
  const variants = await resolveVariants(options);
  if (options.harnessMode === "whole") await verifyWholeHarnessLinks();
  const harnessHash = options.harnessMode === "whole" ? await effectivePiHarnessHash() : await isolatedHarnessHash();
  const runtime = await readRuntimeIdentity(options.harnessMode);
  const runtimeHash = options.harnessMode === "whole" ? runtimeFingerprint(runtime) : null;
  await mkdir(RESULTS_DIR, { recursive: true });

  let promptDir: string | null = null;
  const ensurePromptDir = async (): Promise<string> => (promptDir ??= await makeTemporaryDirectory("pi-probe-variants-"));
  const systemPromptFiles = new Map<string, string>();
  const systemPromptFile = async (variant: Variant, verifierNotice: string | undefined): Promise<string> => {
    const key = `${variant.instructionsHash}:${verifierNotice ?? ""}`;
    const existing = systemPromptFiles.get(key);
    if (existing) return existing;
    const suffix = verifierNotice ? "-verifier" : "";
    const file = join(await ensurePromptDir(), `${variant.instructionsHash.slice(0, 12)}${suffix}.md`);
    const notice = verifierNotice ? `\n\n${automaticVerifierNotice(verifierNotice)}\n` : "";
    await writeFile(file, `${variant.instructions}${notice}`);
    systemPromptFiles.set(key, file);
    return file;
  };
  let judgeSystemPromptFile: string | null = null;
  const ensureJudgeSystemPromptFile = async (): Promise<string> => {
    if (judgeSystemPromptFile) return judgeSystemPromptFile;
    judgeSystemPromptFile = join(await ensurePromptDir(), "judge-system.md");
    await writeFile(judgeSystemPromptFile, "You are a strict evaluator. Follow the output format exactly.\n");
    return judgeSystemPromptFile;
  };

  const rows: string[] = [];
  let totalInfrastructureFailures = 0;
  let totalJudgeUnavailable = 0;
  for (const loaded of scenarios) {
    const { scenario } = loaded;
    for (const model of options.models) {
      for (const variant of variants) {
        const key: RecordKey = {
          harnessMode: options.harnessMode,
          harnessHash,
          runtimeHash,
          scenarioId: scenario.id,
          model,
          instructionsHash: variant.instructionsHash,
          scenarioHash: loaded.hash,
          judgeModel: options.judgeModel,
        };
        const want = { ...key, trials: options.trials };
        const path = join(RESULTS_DIR, recordFileName(key));
        const cell = `${scenario.id} | ${model} | ${variant.label}`;

        if (options.dryRun) {
          const cached = await readRecord(path);
          const comparable = cached && measuresSameSetup(cached, key) ? cached : null;
          const unjudged = comparable ? unavailableJudgements(comparable) : 0;
          const rejudge = unjudged > 0 ? `, would re-judge ${unjudged}` : "";
          if (comparable && isReusable(comparable, want)) {
            rows.push(`${cell} | cached${rejudge} | ${summarizeRecord(comparable, scenario.kind)}`);
            continue;
          }
          const toRun = missingTrials(comparable, want);
          const kept = toRun < options.trials ? ` (${options.trials - toRun} cached)` : "";
          rows.push(`${cell} | would run ${toRun} trials${kept}${rejudge}`);
          continue;
        }

        const holder = await acquireRecordLock(path);
        if (holder) {
          rows.push(`${cell} | skipped: locked by pid ${holder.pid} on ${holder.host} since ${holder.startedAt}`);
          continue;
        }
        try {
          // Read only after locking, so trials another runner just saved are counted.
          const cached = await readRecord(path);
          const now = new Date().toISOString();
          let record: ResultRecord = cached && measuresSameSetup(cached, key)
            ? { ...cached, runtime, variantLabel: variant.label }
            : {
              runnerVersion: RUNNER_VERSION,
              ...key,
              runtime,
              variantLabel: variant.label,
              createdAt: now,
              updatedAt: now,
              trials: [],
              infrastructureFailures: [],
            };

          // Retry judgements that failed earlier from the stored evidence; the agent run is not repeated.
          let rejudged = 0;
          for (const [index, stored] of record.trials.entries()) {
            if (stored.judge.verdict !== "unavailable") continue;
            console.error(`re-judging ${cell} / trial ${stored.trial}`);
            const verdict = await judge(
              scenario,
              stored.finalMessage,
              stored.judgeEvidence,
              options.judgeModel,
              await ensureJudgeSystemPromptFile(),
            );
            if (shuttingDown) return;
            if (verdict.verdict === "unavailable") continue;
            rejudged++;
            const trials = record.trials.map((trial, position) => (position === index ? { ...trial, judge: verdict } : trial));
            record = { ...record, updatedAt: new Date().toISOString(), trials };
            await writeRecord(path, record);
          }
          const rejudgedPart = rejudged > 0 ? `, re-judged ${rejudged}` : "";

          if (isReusable(record, want)) {
            totalJudgeUnavailable += unavailableJudgements(record);
            rows.push(`${cell} | cached${rejudgedPart} | ${summarizeRecord(record, scenario.kind)}`);
            continue;
          }
          const toRun = missingTrials(record, want);
          const keptTrials = record.trials.length;
          let failuresThisRun = 0;

          for (let attempt = 1; attempt <= toRun; attempt++) {
            console.error(`running ${cell} / trial ${record.trials.length + 1} (attempt ${attempt} of ${toRun})`);
            const outcome = await runTrial({
              loaded,
              model,
              judgeModel: options.judgeModel,
              judgeSystemPromptFile: await ensureJudgeSystemPromptFile(),
              systemPromptFile: await systemPromptFile(variant, scenario.verifierNotice),
              harnessMode: options.harnessMode,
            });
            // A child stopped by our own interruption is neither a verdict nor an infrastructure failure.
            if (shuttingDown) return;
            const updatedAt = new Date().toISOString();
            if (outcome.kind === "scored") {
              if (outcome.trial.judge.verdict === "unavailable") console.error(`judge unavailable: ${outcome.trial.judge.reason}`);
              record = { ...record, updatedAt, trials: [...record.trials, { trial: record.trials.length + 1, ...outcome.trial }] };
            } else {
              failuresThisRun++;
              console.error(`infrastructure failure: ${outcome.failure.reason}`);
              record = { ...record, updatedAt, infrastructureFailures: [...record.infrastructureFailures, outcome.failure] };
            }
            await writeRecord(path, record);
          }

          totalInfrastructureFailures += failuresThisRun;
          totalJudgeUnavailable += unavailableJudgements(record);
          const added = record.trials.length - keptTrials;
          const source = `${keptTrials > 0 ? `topped up +${added}` : `fresh ${added}`}${rejudgedPart}`;
          const shortfall = record.trials.length < options.trials ? ` (${options.trials - record.trials.length} short)` : "";
          rows.push(`${cell} | ${source}${shortfall} | ${summarizeRecord(record, scenario.kind, failuresThisRun)}`);
        } finally {
          await releaseRecordLock(path);
        }
      }
    }
  }

  console.log(`\nharness mode: ${options.harnessMode} (${harnessHash.slice(0, 12)})`);
  const packages = runtime.packages ? `, packages ${runtime.packages.map((p) => `${p.source}@${p.version ?? "?"}`).join(", ") || "none"}` : "";
  const runtimePart = runtimeHash ? ` (${runtimeHash.slice(0, 12)})` : " (diagnostic only)";
  console.log(`runtime: pi ${runtime.piVersion}, thinking ${THINKING_LEVEL}${packages}${runtimePart}`);
  console.log(`scenario | model | variant | source | result`);
  for (const row of rows) console.log(row);
  if (totalInfrastructureFailures > 0) {
    console.log(`\n${totalInfrastructureFailures} trial(s) failed for infrastructure reasons and were not scored; rerun to top up.`);
    process.exitCode = 1;
  }
  if (totalJudgeUnavailable > 0) {
    console.log(`\n${totalJudgeUnavailable} stored trial(s) have no judge verdict because the judge failed; rerun to re-judge them.`);
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  if (!shuttingDown) await releaseResources();
}
