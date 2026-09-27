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
import { copyFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { createInterface } from "node:readline";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { brokenBoundaries, evaluateAssertions } from "./lib/assertions.ts";
import {
  addSpend,
  BENCHMARK_BUDGET,
  exhaustedLimit,
  MAX_REPAIR_ROUNDS,
  NO_SPEND,
  repairPrompt,
  type BudgetCaps,
} from "./lib/budget.ts";
import {
  isReusable,
  measuresSameSetup,
  missingTrials,
  RECORD_SCHEMA_VERSION,
  recordFileName,
  RUNNER_VERSION,
  trialTarget,
  type RecordKey,
} from "./lib/cache.ts";
import { fixtureIdentity, isProvisioned, parseFixtureManifest, type ProvisionStamp } from "./lib/fixtures.ts";
import { hashFileSet, hashScenario, sha256Bytes, sha256Hex } from "./lib/hashing.ts";
import {
  factsJudgePrompt,
  judgedOutcome,
  parseDefects,
  parseFacts,
  parseFactsJudgement,
  parseReviewJudgement,
  reviewJudgePrompt,
  VIEWPORT_PROFILES,
} from "./lib/scoring.ts";
import { judgePrompt, parseJudgeVerdict } from "./lib/judge.ts";
import type { LockOwner } from "./lib/lock.ts";
import { descendants, parseProcessTable, stillRunning, type ProcessEntry } from "./lib/processes.ts";
import { redact, redactJson, scanForSecrets, secretEnvValues, type RedactionContext, type SecretFinding } from "./lib/redaction.ts";
import { BOUNDARY_STATEMENT, CONTAMINATION_STATEMENT, summarizeRecord, terminalSafe } from "./lib/report.ts";
import { packageManifestEntries, parseContextWindow, parsePiList, parseSysctlTimeval, runtimeFingerprint, sanitizePackageSource } from "./lib/runtime.ts";
import { parseScenario } from "./lib/scenario.ts";
import { eventUsage, parseProbeRun, type ProbeRun } from "./lib/transcript.ts";
import { HANDOFF_FILE, handoffRequest, resumePrompt } from "./lib/continuation.ts";
import { acquireLock, releaseLock } from "./record-lock.ts";
import { automaticVerifierNotice } from "../pi/agent/extensions/verify-turn/notice.ts";
import type {
  BashExecution,
  BenchmarkJudgement,
  BenchmarkRecord,
  BenchmarkRound,
  BenchmarkScenario,
  BenchmarkTrialRecord,
  BudgetLimit,
  BudgetSpend,
  FixtureSpec,
  HarnessMode,
  HumanReview,
  InfrastructureFailure,
  JudgeVerdict,
  MustFindFact,
  PackageIdentity,
  ProbeScenario,
  ResultRecord,
  RuntimeIdentity,
  Scenario,
  SeededDefect,
  TrialRecord,
  VerifierRun,
} from "./lib/types.ts";

const PROBES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PROBES_DIR, "..");
const SCENARIOS_DIR = join(PROBES_DIR, "scenarios");
const RESULTS_DIR = join(PROBES_DIR, "results");
const FIXTURE_MANIFEST_PATH = join(PROBES_DIR, "fixtures.json");
const FIXTURE_CACHE_DIR = join(PROBES_DIR, ".fixture-cache");
// Benchmark task layout. The patches and answers/ stay outside the agent's copy: patches are applied
// from here before the run, answers/verifier/ is overlaid only onto a separate verification copy.
const START_PATCH = "start.patch";
const CHANGE_PATCH = "change.patch";
const FACTS_FILE = join("answers", "facts.json");
const DEFECTS_FILE = join("answers", "defects.json");
const ARTIFACTS_DIR = join(RESULTS_DIR, "artifacts");
const ANSWERS_DIR = "answers";
const SEED_PATCH = join(ANSWERS_DIR, "seed.patch");
const VERIFIER_OVERLAY = join(ANSWERS_DIR, "verifier");
const INSTRUCTIONS_PATH = "shared/AGENTS.md";
const PACKAGE_MANIFEST_PATH = "pi/agent/packages.txt";

const DEFAULT_MODELS = ["anthropic/claude-sonnet-5", "openai-codex/gpt-6-luna"];
const DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-5";
const DEFAULT_TRIALS = 3;
const DEFAULT_CONCURRENCY = 4;
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
const PROVISION_COMMAND_TIMEOUT_MS = 15 * 60_000;
const KILL_GRACE_MS = durationFromEnv("PI_PROBE_KILL_GRACE_MS", 5_000);
const BENCHMARK_CAPS: BudgetCaps = {
  ...BENCHMARK_BUDGET,
  wallTimeMs: durationFromEnv("PI_PROBE_BENCHMARK_WALL_MS", BENCHMARK_BUDGET.wallTimeMs),
};
const STORED_VERIFIER_OUTPUT_CHARS = 4_000;
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
  /** Whether --trials was given; only the default trial count lets guard scenarios start at one. */
  trialsGiven: boolean;
  concurrency: number;
  scenarioIds: string[];
  judgeModel: string;
  harnessMode: HarnessMode;
  dryRun: boolean;
  includeBenchmarks: boolean;
  provisionFixtures: boolean;
  recordReview: boolean;
  exportDir: string | null;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    compare: false,
    variantFiles: [],
    models: DEFAULT_MODELS,
    trials: DEFAULT_TRIALS,
    trialsGiven: false,
    concurrency: DEFAULT_CONCURRENCY,
    scenarioIds: [],
    judgeModel: DEFAULT_JUDGE_MODEL,
    harnessMode: "isolated",
    dryRun: false,
    includeBenchmarks: false,
    provisionFixtures: false,
    recordReview: false,
    exportDir: null,
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
      case "--trials": options.trials = Number(next()); options.trialsGiven = true; break;
      case "--concurrency": options.concurrency = Number(next()); break;
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
      case "--include-benchmarks": options.includeBenchmarks = true; break;
      case "--provision-fixtures": options.provisionFixtures = true; break;
      case "--record-review": options.recordReview = true; break;
      case "--export": options.exportDir = next(); break;
      case "--help": printUsage(); process.exit(0);
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.trials) || options.trials < 1) throw new Error("--trials must be a positive integer");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  return options;
}

function printUsage(): void {
  console.log(`Usage: bun probes/run.ts [options]

  --compare              Add the git HEAD version of ${INSTRUCTIONS_PATH} as a "baseline" variant
  --variant <path>       Additional instruction file to run (repeatable)
  --scenario <id>        Limit to a scenario (repeatable, default: all)
  --models <a,b>         Models under test (default: ${DEFAULT_MODELS.join(",")})
  --trials <n>           Trials per scenario/model/variant (default: ${DEFAULT_TRIALS}; guard scenarios
                         start at 1 and top up to ${DEFAULT_TRIALS} after a failing trial)
  --concurrency <n>      Scenario/model/variant cells run at once (default: ${DEFAULT_CONCURRENCY})
  --judge-model <id>     Judge model (default: ${DEFAULT_JUDGE_MODEL})
  --harness-mode <mode>  isolated (default) or whole
  --dry-run              Report what would run and what is cached, without calling any model
  --include-benchmarks   Also run benchmark scenarios when no --scenario is given (named ones always run)
  --provision-fixtures   Clone pinned benchmark fixtures and run their setup (network), then exit;
                         limited to the fixtures of --scenario tasks when given
  --record-review        Record human verdicts for sampled benchmark trials (reads stdin), then exit
  --export <dir>         Write a redacted, secret-scanned release of benchmark records and artifacts
                         (limited to --scenario tasks when given), then exit

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

type BoundedResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/** Reads a stream to the end, passing each complete LF-terminated line to `onLine` as it arrives. */
async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  let pending = "";
  for await (const chunk of stream) {
    const piece = decoder.decode(chunk, { stream: true });
    text += piece;
    pending += piece;
    for (let newline = pending.indexOf("\n"); newline >= 0; newline = pending.indexOf("\n")) {
      onLine(pending.slice(0, newline).replace(/\r$/, ""));
      pending = pending.slice(newline + 1);
    }
  }
  return text + decoder.decode();
}

/**
 * Runs a child in its own process group so a timeout or interruption can stop the whole tree.
 * `stopWhen` sees each stdout line as it arrives and stops the child once it returns true.
 */
async function runBounded(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  env: Record<string, string | undefined> = process.env,
  stopWhen?: (line: string) => boolean,
): Promise<BoundedResult> {
  if (shuttingDown) throw new Error("probe run interrupted");
  const proc = Bun.spawn(argv, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
  activeProcesses.add(proc);
  let timedOut = false;
  let stopped = false;
  // Awaited before returning, so descendants a stopped child leaves behind cannot keep changing its
  // working directory while the caller verifies or copies it.
  let termination: Promise<void> | null = null;
  const timer = setTimeout(() => {
    if (stopped) return;
    timedOut = true;
    termination = terminate(proc);
  }, timeoutMs);
  const stdoutText = stopWhen
    ? readLines(proc.stdout, (line) => {
      if (stopped || timedOut) return;
      stopped = stopWhen(line);
      if (stopped) termination = terminate(proc);
    })
    : new Response(proc.stdout).text();
  try {
    const [stdout, stderr, exitCode] = await Promise.all([stdoutText, new Response(proc.stderr).text(), proc.exited]);
    await termination;
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

function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/** Every file below `root`, keyed by path relative to it and mapped by `read`; empty when absent. */
async function readTreeAs(root: string, read: (path: string) => Promise<string>): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  if (!(await pathExists(root))) return files;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.set(relative(root, full), await read(full));
    }
  };
  await walk(root);
  return files;
}

function readTree(root: string): Promise<Map<string, string>> {
  return readTreeAs(root, (path) => readFile(path, "utf8"));
}

/** SHA-256 of each file's raw bytes, so binary files such as reference screenshots hash exactly. */
function readTreeDigests(root: string): Promise<Map<string, string>> {
  return readTreeAs(root, async (path) => sha256Bytes(await readFile(path)));
}

async function readFixtureManifest(): Promise<Map<string, FixtureSpec>> {
  if (!(await pathExists(FIXTURE_MANIFEST_PATH))) return new Map();
  try {
    return parseFixtureManifest(JSON.parse(await readFile(FIXTURE_MANIFEST_PATH, "utf8")));
  } catch (error) {
    throw new Error(`${relative(REPO_ROOT, FIXTURE_MANIFEST_PATH)}: ${(error as Error).message}`);
  }
}

type LoadedScenario = {
  scenario: Scenario;
  dir: string;
  /** Inline `fixture/` files; empty for a benchmark on a pinned fixture. */
  fixture: Map<string, string>;
  /** Pinned fixture of a benchmark task, when it names one. */
  fixtureSpec: FixtureSpec | null;
  /** What a judged benchmark is scored against, validated at load; null for verifier scoring and probes. */
  answerKey: AnswerKey | null;
  hash: string;
};

type AnswerKey = { scoring: "facts"; facts: MustFindFact[] } | { scoring: "review"; defects: SeededDefect[] };

/**
 * Byte digests of everything that decides a benchmark trial: the inline fixture under its own paths,
 * then, under keys that cannot collide with them, the pinned fixture identity, the starting-state
 * patch, and every answer file.
 */
async function benchmarkHashInputs(dir: string, fixtureSpec: FixtureSpec | null): Promise<Map<string, string>> {
  const inputs = await readTreeDigests(join(dir, "fixture"));
  if (fixtureSpec) inputs.set("@fixture", fixtureIdentity(fixtureSpec));
  const startPatch = join(dir, START_PATCH);
  for (const patch of [START_PATCH, CHANGE_PATCH]) {
    const path = join(dir, patch);
    if (await pathExists(path)) inputs.set(`@task/${patch}`, sha256Bytes(await readFile(path)));
  }
  for (const [path, digest] of await readTreeDigests(join(dir, ANSWERS_DIR))) inputs.set(`@${ANSWERS_DIR}/${path}`, digest);
  return inputs;
}

/**
 * Named scenarios always load. Without names, benchmark tasks load only with `includeBenchmarks`,
 * so a routine instruction comparison never runs the capped, expensive benchmark corpus.
 */
async function loadScenarios(ids: string[], includeBenchmarks: boolean, manifest: Map<string, FixtureSpec>): Promise<LoadedScenario[]> {
  const entries = await readdir(SCENARIOS_DIR, { withFileTypes: true });
  const loaded: LoadedScenario[] = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (ids.length > 0 && !ids.includes(entry.name)) continue;
    const dir = join(SCENARIOS_DIR, entry.name);
    const raw: unknown = JSON.parse(await readFile(join(dir, "scenario.json"), "utf8"));
    // Skip excluded benchmarks before validating them, so an unfinished task cannot block probe runs.
    const isBenchmark = typeof raw === "object" && raw !== null && (raw as { kind?: unknown }).kind === "benchmark";
    if (isBenchmark && ids.length === 0 && !includeBenchmarks) continue;
    const scenario = parseScenario(raw, entry.name);
    const fixture = await readTree(join(dir, "fixture"));
    if (scenario.kind !== "benchmark") {
      if (scenario.kind === "multi-turn" && fixture.size === 0) {
        throw new Error(`scenario ${entry.name}: multi-turn scenarios need a fixture/ directory`);
      }
      loaded.push({ scenario, dir, fixture, fixtureSpec: null, answerKey: null, hash: hashScenario(scenario, fixture) });
      continue;
    }

    const fixtureSpec = scenario.fixture === undefined ? null : manifest.get(scenario.fixture) ?? null;
    if (scenario.fixture !== undefined && !fixtureSpec) {
      throw new Error(`scenario ${entry.name}: fixture ${scenario.fixture} is not in ${relative(REPO_ROOT, FIXTURE_MANIFEST_PATH)}`);
    }
    if ((fixtureSpec !== null) === (fixture.size > 0)) {
      throw new Error(`scenario ${entry.name}: a benchmark needs either a pinned fixture or a fixture/ directory, not both`);
    }
    const answerKey = async <T>(file: string, parse: (raw: unknown) => T): Promise<T> => {
      const path = join(dir, file);
      if (!(await pathExists(path))) throw new Error(`scenario ${entry.name}: ${scenario.scoring}-scored benchmarks need ${file}`);
      try {
        return parse(JSON.parse(await readFile(path, "utf8")));
      } catch (error) {
        throw new Error(`scenario ${entry.name}: ${(error as Error).message}`);
      }
    };
    let key: AnswerKey | null = null;
    if (scenario.scoring === "facts") key = { scoring: "facts", facts: await answerKey(FACTS_FILE, parseFacts) };
    if (scenario.scoring === "review") {
      key = { scoring: "review", defects: await answerKey(DEFECTS_FILE, parseDefects) };
      if (!(await pathExists(join(dir, CHANGE_PATCH)))) {
        throw new Error(`scenario ${entry.name}: review-scored benchmarks need ${CHANGE_PATCH}, the change to review`);
      }
    }
    loaded.push({ scenario, dir, fixture, fixtureSpec, answerKey: key, hash: hashScenario(scenario, await benchmarkHashInputs(dir, fixtureSpec)) });
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

type PiOutcome =
  | { kind: "completed"; run: ProbeRun; wallTimeMs: number }
  | { kind: "failed"; reason: string };

/**
 * A budgeted child: `spent` is cumulative across the trial including this child, and `exhausted`
 * names the cap that stopped it. A timeout is the wall-time cap, not an infrastructure failure.
 */
type BudgetedPiOutcome =
  | { kind: "completed" | "exhausted"; run: ProbeRun; wallTimeMs: number; spent: BudgetSpend; exhausted: BudgetLimit | null }
  | { kind: "failed"; reason: string };

type PiArgs = {
  model: string;
  systemPromptFile: string;
  prompt: string;
  cwd: string;
  withTools: boolean;
  harnessMode: HarnessMode;
  env?: Record<string, string | undefined>;
  /** Persist the session in `dir`; `continue` resumes its latest session instead of starting one. */
  session?: { dir: string; continue: boolean };
};

function piArgv(args: PiArgs): string[] {
  const argv = [
    "pi", "-p", "--mode", "json",
    "--model", args.model,
    "--thinking", THINKING_LEVEL,
    ...(args.session
      ? ["--session-dir", args.session.dir, ...(args.session.continue ? ["--continue"] : [])]
      : ["--no-session"]),
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
  return argv;
}

/** Why a child that exited on its own did not produce a usable run, or null when it did. */
function incompleteReason(result: BoundedResult, run: ProbeRun): string | null {
  const stderr = result.stderr.trim().slice(0, 500);
  if (result.exitCode !== 0) return `pi exited ${result.exitCode}: ${stderr}`;
  if (!run.completion.complete) return `pi run incomplete: ${run.completion.reason}. ${stderr}`.trim();
  return null;
}

/**
 * Why a child's timing cannot be trusted because the host slept after `started`, or null. Timers and
 * wall time both count time asleep, so a lid closed mid-run would otherwise read as a slow agent or a
 * timeout. Only macOS exposes the last sleep (`kern.sleeptime`); elsewhere this returns null.
 */
async function hostSleptSince(started: number): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const lastSleep = parseSysctlTimeval(await runMetadataCommand(["sysctl", "-n", "kern.sleeptime"], REPO_ROOT).catch(() => ""));
  return lastSleep !== null && lastSleep >= started ? `host slept during the run (at ${new Date(lastSleep).toISOString()})` : null;
}

async function runPi(args: PiArgs & { timeoutMs: number }): Promise<PiOutcome> {
  const started = Date.now();
  const result = await runBounded(piArgv(args), args.cwd, args.timeoutMs, args.env);
  const wallTimeMs = Date.now() - started;
  const slept = await hostSleptSince(started);
  if (slept) return { kind: "failed", reason: slept };
  if (result.timedOut) return { kind: "failed", reason: `pi timed out after ${args.timeoutMs / 1000}s` };
  const run = parseProbeRun(result.stdout);
  const incomplete = incompleteReason(result, run);
  return incomplete ? { kind: "failed", reason: incomplete } : { kind: "completed", run, wallTimeMs };
}

/** `error` or `aborted` with its message when an assistant `message_end` reports a failed request, else null. */
function assistantError(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return null;
  const message = (event as { message?: { stopReason?: unknown; errorMessage?: unknown } }).message;
  if (message?.stopReason !== "error" && message?.stopReason !== "aborted") return null;
  return typeof message.errorMessage === "string" && message.errorMessage !== "" ? `${message.stopReason}: ${message.errorMessage}` : message.stopReason;
}

/**
 * Runs a child against the remaining trial budget. Token and cost caps are checked on every
 * streamed `message_end`, so a child is stopped as soon as the reported usage reaches a cap; usage
 * of a request still in flight at that moment is never reported and not counted.
 */
async function runBudgetedPi(args: PiArgs & { caps: BudgetCaps; spent: BudgetSpend }): Promise<BudgetedPiOutcome> {
  let spent = args.spent;
  let limitReached: BudgetLimit | null = null;
  // A provider error on the very request that reached a cap is an agent failure, not exhaustion.
  let cappingRequestError: string | null = null;
  const stopWhen = (line: string): boolean => {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return false;
    }
    const usage = eventUsage(event);
    if (!usage || usage.usage === "missing") return false;
    spent = addSpend(spent, usage.usage);
    limitReached = exhaustedLimit(spent, args.caps);
    if (limitReached && usage.source === "assistant") cappingRequestError = assistantError(event);
    return limitReached !== null;
  };
  const started = Date.now();
  const result = await runBounded(piArgv(args), args.cwd, args.caps.wallTimeMs - args.spent.wallTimeMs, args.env, stopWhen);
  const wallTimeMs = Date.now() - started;
  const slept = await hostSleptSince(started);
  if (slept) return { kind: "failed", reason: slept };
  spent = { ...spent, wallTimeMs: args.spent.wallTimeMs + wallTimeMs };
  const run = parseProbeRun(result.stdout);
  if (cappingRequestError !== null) return { kind: "failed", reason: `final assistant request ended with ${cappingRequestError}` };
  const exhausted = limitReached ?? (result.timedOut ? "wall_time" : null);
  if (exhausted) return { kind: "exhausted", run, wallTimeMs, spent, exhausted };
  const incomplete = incompleteReason(result, run);
  return incomplete ? { kind: "failed", reason: incomplete } : { kind: "completed", run, wallTimeMs, spent, exhausted: null };
}

async function runFixtureCommand(
  command: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ exitCode: number | null; output: string }> {
  const result = await runBounded(command, cwd, FIXTURE_COMMAND_TIMEOUT_MS, env);
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

type TrialOutcome<T> =
  | { kind: "scored"; trial: Omit<T, "trial"> }
  | { kind: "infrastructure"; failure: InfrastructureFailure };

function infrastructure(reason: string): { kind: "infrastructure"; failure: InfrastructureFailure } {
  return { kind: "infrastructure", failure: { reason, at: new Date().toISOString() } };
}

async function runTrial(args: {
  loaded: LoadedScenario;
  scenario: ProbeScenario;
  model: string;
  judgeModel: string;
  judgeSystemPromptFile: string;
  systemPromptFile: string;
  harnessMode: HarnessMode;
}): Promise<TrialOutcome<TrialRecord>> {
  const { loaded, scenario, model, judgeModel, judgeSystemPromptFile, systemPromptFile, harnessMode } = args;

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
        wallTimeMs: agent.wallTimeMs,
        telemetry: agent.run.telemetry,
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
    const observation = {
      checkExitCode: after.exitCode,
      changedFiles: await changedFixtureFiles(workDir, loaded.fixture),
      bashExecutions: run.bashExecutions,
    };
    const assertions = evaluateAssertions(scenario.assertions ?? {}, observation);
    const broken = brokenBoundaries(scenario.assertions ?? {}, observation);
    const reported = scenario.reportCommand ? await runFixtureCommand(scenario.reportCommand, workDir) : null;
    const checkEvidence = [
      `${scenario.checkCommand!.join(" ")} exited ${after.exitCode ?? "(timed out)"}:\n${after.output}`,
      reported ? `${scenario.reportCommand!.join(" ")} exited ${reported.exitCode ?? "(timed out)"}:\n${reported.output}` : null,
      `Bash commands the agent ran: ${describeExecutions(run.bashExecutions)}`,
    ].filter((part): part is string => part !== null).join("\n\n");
    const verdict: JudgeVerdict = broken.length > 0
      ? { verdict: "skipped", reason: `hard boundary broken: ${broken.join("; ")}` }
      : await judge(scenario, run.finalMessage, checkEvidence, judgeModel, judgeSystemPromptFile);
    return {
      kind: "scored",
      trial: {
        assertions,
        judge: verdict,
        judgeEvidence: checkEvidence,
        bashExecutions: run.bashExecutions,
        finalMessage: run.finalMessage,
        wallTimeMs: agent.wallTimeMs,
        telemetry: run.telemetry,
      },
    };
  } finally {
    await removeTemporaryDirectory(workDir);
  }
}

// The runner's own git commands ignore user and system configuration, so hooks, signing, or
// templates configured on the host cannot change a prepared fixture.
const RUNNER_GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "probe-runner",
  GIT_AUTHOR_EMAIL: "probe-runner@example.invalid",
  GIT_COMMITTER_NAME: "probe-runner",
  GIT_COMMITTER_EMAIL: "probe-runner@example.invalid",
};

async function runChecked(argv: string[], cwd: string, timeoutMs: number, env: Record<string, string | undefined> = RUNNER_GIT_ENV): Promise<string> {
  const result = await runBounded(argv, cwd, timeoutMs, env);
  if (result.exitCode !== 0) {
    const status = result.timedOut ? `timed out after ${timeoutMs / 1000}s` : `exit ${result.exitCode}`;
    throw new Error(`${argv.join(" ")} failed in ${cwd} (${status}): ${`${result.stdout}${result.stderr}`.trim().slice(-1000)}`);
  }
  return result.stdout;
}

/** Copies a directory tree to a new path, sharing blocks copy-on-write where the filesystem allows. */
async function cloneTree(source: string, destination: string): Promise<void> {
  const argv = process.platform === "darwin"
    ? ["cp", "-c", "-R", source, destination]
    : ["cp", "-R", "--reflink=auto", source, destination];
  await runChecked(argv, REPO_ROOT, FIXTURE_COMMAND_TIMEOUT_MS, process.env);
}

function fixtureCheckout(spec: FixtureSpec): string {
  return join(FIXTURE_CACHE_DIR, spec.name, "checkout");
}

function provisionStampPath(spec: FixtureSpec): string {
  return join(FIXTURE_CACHE_DIR, spec.name, "provisioned.json");
}

async function readProvisionStamp(spec: FixtureSpec): Promise<unknown> {
  return readFile(provisionStampPath(spec), "utf8").then((text) => JSON.parse(text) as unknown, () => null);
}

/** A matching stamp counts only while its checkout still exists; the cache is local and can be pruned. */
async function fixtureReady(spec: FixtureSpec): Promise<boolean> {
  return isProvisioned(await readProvisionStamp(spec), spec) && pathExists(fixtureCheckout(spec));
}

/**
 * Clones a pinned fixture at its commit and runs its setup commands, with network access. Trials
 * later copy this checkout and never fetch. An up-to-date checkout is left alone.
 */
async function provisionFixture(spec: FixtureSpec): Promise<"provisioned" | "up to date"> {
  if (await fixtureReady(spec)) return "up to date";
  const root = join(FIXTURE_CACHE_DIR, spec.name);
  const checkout = fixtureCheckout(spec);
  await rm(root, { recursive: true, force: true });
  await mkdir(checkout, { recursive: true });
  const git = (...args: string[]) => runChecked(["git", ...args], checkout, PROVISION_COMMAND_TIMEOUT_MS);
  await git("init", "-q");
  await git("remote", "add", "origin", spec.repository);
  // Fetching one commit by SHA is fast where the server allows it; otherwise fetch everything.
  await git("fetch", "-q", "--depth", "1", "origin", spec.commit).catch(() => git("fetch", "-q", "origin"));
  await git("checkout", "-q", "--detach", spec.commit);
  const head = (await git("rev-parse", "HEAD")).trim();
  if (head !== spec.commit) throw new Error(`fixture ${spec.name}: checked out ${head}, expected ${spec.commit}`);
  const setupEnv = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: fixtureBrowsersPath(spec) };
  for (const command of spec.setup) await runChecked(command, checkout, PROVISION_COMMAND_TIMEOUT_MS, setupEnv);
  const stamp: ProvisionStamp = { identity: fixtureIdentity(spec), commit: spec.commit, provisionedAt: new Date().toISOString() };
  await writeFile(provisionStampPath(spec), `${JSON.stringify(stamp, null, 2)}\n`);
  return "provisioned";
}

/**
 * Builds the agent's copy at `workDir`: the pinned checkout or inline fixture, then the task's
 * starting-state patch and seeded-defect patch applied from outside the copy. The copy gets a fresh
 * single-commit repository, so `git diff` shows the agent's own changes but no upstream history or
 * seeded patch. A review task's `change.patch` becomes a second commit, the change to review.
 */
async function prepareBenchmarkCopy(loaded: LoadedScenario, workDir: string): Promise<void> {
  const { fixtureSpec, scenario } = loaded;
  if (fixtureSpec) {
    if (!(await fixtureReady(fixtureSpec))) {
      throw new Error(`scenario ${scenario.id}: fixture ${fixtureSpec.name} is not provisioned; run bun probes/run.ts --provision-fixtures`);
    }
    await cloneTree(fixtureCheckout(fixtureSpec), workDir);
    await rm(join(workDir, ".git"), { recursive: true, force: true });
  } else {
    await cp(join(loaded.dir, "fixture"), workDir, { recursive: true });
  }
  for (const patch of [START_PATCH, SEED_PATCH]) {
    const path = join(loaded.dir, patch);
    if (await pathExists(path)) await runChecked(["git", "apply", "--whitespace=nowarn", path], workDir, FIXTURE_COMMAND_TIMEOUT_MS);
  }
  const git = (...args: string[]) => runChecked(["git", ...args], workDir, FIXTURE_COMMAND_TIMEOUT_MS);
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-q", "--no-verify", "--no-gpg-sign", "-m", "Initial state");
  const changePatch = join(loaded.dir, CHANGE_PATCH);
  if (await pathExists(changePatch)) {
    await git("apply", "--whitespace=nowarn", changePatch);
    await git("add", "-A");
    await git("commit", "-q", "--no-verify", "--no-gpg-sign", "-m", "Change under review");
  }
}

/** Where provisioning installs a pinned fixture's Playwright browsers and verifiers find them offline. */
function fixtureBrowsersPath(spec: FixtureSpec): string {
  return join(FIXTURE_CACHE_DIR, spec.name, "browsers");
}

/**
 * Regular files below `root` as paths relative to it. Symlinks and other special entries are
 * skipped and never followed: artifacts are written by verifier code the agent can influence, and a
 * link could otherwise carry a host file into the results or a release.
 */
async function regularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(relative(root, full));
    }
  };
  await walk(root);
  return files.sort();
}

/**
 * Runs the verifier on a disposable copy of the agent's work with `answers/verifier/` overlaid, so
 * hidden tests never enter the agent's copy and verifier side effects never touch it. Paths of the
 * copy are rewritten to the agent's path in the output fed back to it.
 *
 * The verifier receives PROBE_VIEWPORTS (VIEWPORT_PROFILES as JSON), PROBE_ARTIFACT_DIR, and, for a
 * pinned fixture, PLAYWRIGHT_BROWSERS_PATH. Files it leaves in the artifact directory, such as
 * screenshots, move to `artifactDir` and are returned relative to `probes/results`.
 */
let verifierQueue: Promise<unknown> = Promise.resolve();

/**
 * Verifies one copy at a time across concurrent cells. Hidden verifiers may bind fixed ports (the
 * frontend ones start Vite on 41187), and they live under `answers/`, where changing them would
 * invalidate stored records. Verification takes seconds, so serializing it costs little.
 */
function verifyInCopy(...args: Parameters<typeof verifyInCopyNow>): ReturnType<typeof verifyInCopyNow> {
  const run = verifierQueue.then(() => verifyInCopyNow(...args));
  verifierQueue = run.catch(() => undefined);
  return run;
}

async function verifyInCopyNow(
  loaded: LoadedScenario,
  verifyCommand: string[],
  workDir: string,
  artifactDir: string,
): Promise<{ exitCode: number | null; output: string; artifacts: string[] }> {
  const verifyRoot = await makeTemporaryDirectory("pi-probe-verify-");
  try {
    const copy = join(verifyRoot, "work");
    const scratchArtifacts = join(verifyRoot, "artifacts");
    await mkdir(scratchArtifacts);
    await cloneTree(workDir, copy);
    const overlay = join(loaded.dir, VERIFIER_OVERLAY);
    if (await pathExists(overlay)) await cp(overlay, copy, { recursive: true, force: true });
    const env = {
      ...process.env,
      PROBE_VIEWPORTS: JSON.stringify(VIEWPORT_PROFILES),
      PROBE_ARTIFACT_DIR: scratchArtifacts,
      ...(loaded.fixtureSpec ? { PLAYWRIGHT_BROWSERS_PATH: fixtureBrowsersPath(loaded.fixtureSpec) } : {}),
    };
    const result = await runFixtureCommand(verifyCommand, copy, env);
    const copyPaths = [...new Set([copy, await realpath(copy)])];
    const output = copyPaths.reduce((text, path) => text.replaceAll(path, workDir), result.output);
    const produced = await regularFiles(scratchArtifacts);
    for (const file of produced) {
      await mkdir(dirname(join(artifactDir, file)), { recursive: true });
      await copyFile(join(scratchArtifacts, file), join(artifactDir, file));
    }
    return { exitCode: result.exitCode, output, artifacts: produced.map((file) => relative(RESULTS_DIR, join(artifactDir, file))) };
  } finally {
    await removeTemporaryDirectory(verifyRoot);
  }
}

/**
 * Runs the task, then the verifier; on failure sends the verifier output back into the latest session
 * with `--continue`, at most MAX_REPAIR_ROUNDS times. This approximates verify-turn, whose
 * `agent_settled` trigger never fires in print mode.
 *
 * A continuation task first runs its prompt as phase 1, asks that session for a handoff note, and
 * removes the note from the workspace; phase 2 then starts a fresh session with the note pasted into
 * its prompt, and verification and repair apply to phase 2. Budget caps span every round.
 *
 * A facts or review task runs one round and is scored by the judge from its final message; it has
 * no verifier and no repair rounds.
 */
async function runBenchmarkTrial(args: {
  loaded: LoadedScenario;
  scenario: BenchmarkScenario;
  model: string;
  systemPromptFile: string;
  harnessMode: HarnessMode;
  judge: { model: string; systemPromptFile: string };
  /** Where this trial's verifier artifacts are kept. */
  artifactRoot: string;
}): Promise<TrialOutcome<BenchmarkTrialRecord>> {
  const { loaded, scenario, model, systemPromptFile, harnessMode } = args;
  const { verifyCommand } = scenario;
  const trialRoot = await makeTemporaryDirectory(`pi-probe-${scenario.id}-`);
  const workDir = join(trialRoot, "work");
  // One directory per session, so `--continue` can only ever resume the intended one.
  const sessionRoot = await makeTemporaryDirectory("pi-probe-session-");
  try {
    await prepareBenchmarkCopy(loaded, workDir);
    const rounds: BenchmarkRound[] = [];
    let spent = NO_SPEND;
    let continuation: BenchmarkTrialRecord["continuation"] = null;
    let sessions = 0;
    const newSession = async () => {
      const dir = join(sessionRoot, String(++sessions));
      await mkdir(dir);
      return dir;
    };

    let exhaustedLimit: BudgetLimit | null = null;
    /** Runs one child and records it as a round without a verifier result. */
    const runRound = async (
      kind: BenchmarkRound["kind"],
      prompt: string,
      session: { dir: string; continue: boolean },
    ): Promise<"completed" | "exhausted" | { failed: string }> => {
      const agent = await runBudgetedPi({
        model,
        systemPromptFile,
        prompt,
        cwd: workDir,
        withTools: true,
        harnessMode,
        env: { ...process.env, ...PACKAGE_INSTALL_GUARD_ENV },
        session,
        caps: BENCHMARK_CAPS,
        spent,
      });
      if (agent.kind === "failed") return { failed: agent.reason };
      spent = agent.spent;
      exhaustedLimit = agent.exhausted;
      rounds.push({
        round: rounds.length,
        kind,
        wallTimeMs: agent.wallTimeMs,
        telemetry: agent.run.telemetry,
        finalMessage: agent.run.finalMessage,
        bashExecutions: agent.run.bashExecutions,
        artifacts: [],
        verifier: null,
      });
      return agent.kind;
    };
    /** Verifies the agent's work and attaches the result and artifacts to the latest round. */
    const verifyLatestRound = async (command: string[]): Promise<{ exitCode: number | null; output: string }> => {
      const index = rounds.length - 1;
      const verification = await verifyInCopy(loaded, command, workDir, join(args.artifactRoot, `round-${index}`));
      const verifier: VerifierRun = { exitCode: verification.exitCode, output: verification.output.slice(-STORED_VERIFIER_OUTPUT_CHARS) };
      rounds[index] = { ...rounds[index], verifier, artifacts: verification.artifacts };
      return verification;
    };
    // The verifier runs after a budget stop in any round, for information only.
    const budgetExhausted = async () => {
      if (verifyCommand) await verifyLatestRound(verifyCommand);
      return scored("budget_exhausted");
    };
    let judgement: BenchmarkJudgement | null = null;
    const scored = (outcome: BenchmarkTrialRecord["outcome"]): TrialOutcome<BenchmarkTrialRecord> => ({
      kind: "scored",
      trial: {
        outcome,
        exhaustedLimit,
        repairRounds: rounds.filter((round) => round.kind === "repair").length,
        spent,
        continuation,
        judgement,
        humanReview: null,
        rounds,
      },
    });

    let prompt = scenario.prompt;
    let kind: BenchmarkRound["kind"] = "task";
    let session = { dir: await newSession(), continue: false };
    if (!verifyCommand) {
      const task = await runRound("task", scenario.prompt, session);
      if (typeof task === "object") return infrastructure(task.failed);
      if (task === "exhausted") return await budgetExhausted();
      judgement = await judgeBenchmark(loaded, rounds[0].finalMessage, args.judge.model, args.judge.systemPromptFile);
      return scored(judgedOutcome(judgement));
    }
    const verifierLabel = verifyCommand.join(" ");
    if (scenario.continuation) {
      const task = await runRound("task", scenario.prompt, session);
      if (typeof task === "object") return infrastructure(`phase 1: ${task.failed}`);
      if (task === "exhausted") return await budgetExhausted();
      const handoff = await runRound("handoff", handoffRequest(), { ...session, continue: true });
      if (typeof handoff === "object") return infrastructure(`handoff: ${handoff.failed}`);
      const handoffPath = join(workDir, HANDOFF_FILE);
      const written = await readFile(handoffPath, "utf8").catch(() => null);
      const note = written !== null && written.trim() !== "" ? written : null;
      await rm(handoffPath, { force: true });
      continuation = { handoff: note };
      if (handoff === "exhausted") return await budgetExhausted();
      prompt = resumePrompt(scenario.continuation.prompt, note);
      kind = "resume";
      session = { dir: await newSession(), continue: false };
    }

    for (let repair = 0; ; repair++) {
      const round = await runRound(kind, prompt, session);
      if (typeof round === "object") {
        const label = kind === "repair" ? `repair round ${repair}: ` : kind === "resume" ? "phase 2: " : "";
        return infrastructure(`${label}${round.failed}`);
      }
      if (round === "exhausted") return await budgetExhausted();
      const verification = await verifyLatestRound(verifyCommand);
      if (verification.exitCode === 0) return scored("passed");
      if (repair === MAX_REPAIR_ROUNDS) return scored("failed");
      prompt = repairPrompt(repair + 1, verifierLabel, verification.output);
      kind = "repair";
      session = { ...session, continue: true };
    }
  } finally {
    await Promise.all([removeTemporaryDirectory(trialRoot), removeTemporaryDirectory(sessionRoot)]);
  }
}

/**
 * Scores a facts or review task's final message against its answer key. A failed judge child yields
 * `unavailable`, so the paid agent run is kept and re-judged on a later run.
 */
async function judgeBenchmark(
  loaded: LoadedScenario,
  answer: string,
  judgeModel: string,
  judgeSystemPromptFile: string,
): Promise<BenchmarkJudgement> {
  const key = loaded.answerKey;
  // loadScenarios attaches an answer key to every judged benchmark.
  if (!key) throw new Error(`scenario ${loaded.scenario.id}: no answer key to judge against`);
  const prompt = key.scoring === "facts"
    ? factsJudgePrompt(loaded.scenario.prompt, key.facts, answer)
    : reviewJudgePrompt(loaded.scenario.prompt, key.defects, answer);
  const outcome = await runPi({
    model: judgeModel,
    systemPromptFile: judgeSystemPromptFile,
    prompt,
    cwd: REPO_ROOT,
    withTools: false,
    harnessMode: "isolated",
    timeoutMs: JUDGE_TIMEOUT_MS,
  });
  if (outcome.kind === "failed") return { scoring: key.scoring, verdict: "unavailable", reason: outcome.reason.slice(0, 200) };
  return key.scoring === "facts"
    ? parseFactsJudgement(outcome.run.finalMessage, key.facts)
    : parseReviewJudgement(outcome.run.finalMessage, key.defects);
}

/**
 * The judge never sees an instruction variant; it scores behavior, not compliance wording.
 * A failed judge child yields an `unavailable` verdict, so the paid agent run and its
 * deterministic assertions are still kept.
 */
async function judge(
  scenario: ProbeScenario,
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

/** Stored trials still awaiting a judge verdict: probe trials judged `unavailable`, benchmark trials `unjudged`. */
function unavailableJudgements(record: ResultRecord): number {
  if (record.scenarioKind === "benchmark") return record.trials.filter((trial) => trial.outcome === "unjudged").length;
  return record.trials.filter((trial) => trial.judge.verdict === "unavailable").length;
}

type BenchmarkDetails = Pick<BenchmarkRecord, "contextWindow" | "fixture">;

function newRecord(
  scenario: Scenario,
  base: Omit<ResultRecord, "scenarioKind" | "trials" | keyof BenchmarkDetails>,
  benchmark: BenchmarkDetails,
): ResultRecord {
  return scenario.kind === "benchmark"
    ? { ...base, scenarioKind: "benchmark", ...benchmark, trials: [] }
    : { ...base, scenarioKind: scenario.kind, trials: [] };
}

function fixtureProvenance(spec: FixtureSpec | null): BenchmarkDetails["fixture"] {
  if (!spec) return null;
  const { setup: _, ...provenance } = spec;
  return provenance;
}

/** Runs one trial of the record's scenario and returns the record with the outcome appended. */
async function runAndRecordTrial(
  record: ResultRecord,
  run: {
    probe: (scenario: ProbeScenario) => Promise<TrialOutcome<TrialRecord>>;
    benchmark: (scenario: BenchmarkScenario, trial: number) => Promise<TrialOutcome<BenchmarkTrialRecord>>;
  },
  scenario: Scenario,
): Promise<{ record: ResultRecord; failure: InfrastructureFailure | null }> {
  const trial = record.trials.length + 1;
  const fail = (failure: InfrastructureFailure) => ({
    record: { ...record, updatedAt: new Date().toISOString(), infrastructureFailures: [...record.infrastructureFailures, failure] },
    failure,
  });
  if (record.scenarioKind === "benchmark" && scenario.kind === "benchmark") {
    const outcome = await run.benchmark(scenario, trial);
    if (outcome.kind === "infrastructure") return fail(outcome.failure);
    return { record: { ...record, updatedAt: new Date().toISOString(), trials: [...record.trials, { trial, ...outcome.trial }] }, failure: null };
  }
  if (record.scenarioKind !== "benchmark" && scenario.kind !== "benchmark") {
    const outcome = await run.probe(scenario);
    if (outcome.kind === "infrastructure") return fail(outcome.failure);
    return { record: { ...record, updatedAt: new Date().toISOString(), trials: [...record.trials, { trial, ...outcome.trial }] }, failure: null };
  }
  // Unreachable: the scenario hash, which covers the kind, is part of the record key.
  throw new Error(`record kind ${record.scenarioKind} does not match scenario kind ${scenario.kind}`);
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

function describeTrialForReview(record: BenchmarkRecord, trial: BenchmarkTrialRecord, task: string): string {
  const last = trial.rounds[trial.rounds.length - 1];
  const verified = [...trial.rounds].reverse().find((round) => round.verifier !== null);
  const artifacts = trial.rounds.flatMap((round) => round.artifacts).map((path) => join(RESULTS_DIR, path));
  const judgement = trial.judgement?.verdict === "judged"
    ? `recall ${trial.judgement.recall.toFixed(2)}${trial.judgement.scoring === "review" ? `, precision ${trial.judgement.precision?.toFixed(2) ?? "n/a"}` : ""}`
    : trial.judgement ? `judge ${trial.judgement.verdict}` : null;
  // Final messages, verifier output, and even artifact names are agent-controlled.
  return terminalSafe([
    `\n=== ${record.scenarioId} | ${record.model} | ${record.variantLabel} | trial ${trial.trial} ===`,
    `outcome: ${trial.outcome}${judgement ? ` (${judgement})` : ""}`,
    `task: ${task.slice(0, 500)}`,
    `final message:\n${(last?.finalMessage ?? "").slice(0, 2000)}`,
    verified?.verifier ? `verifier exit ${verified.verifier.exitCode ?? "timeout"}:\n${verified.verifier.output.slice(-1500)}` : null,
    artifacts.length > 0 ? `artifacts:\n${artifacts.map((path) => `  ${path}`).join("\n")}` : null,
  ].filter((part): part is string => part !== null).join("\n"));
}

/**
 * Walks sampled benchmark trials without a human verdict and records pass or fail with a note from
 * stdin. A trial is sampled when its number is at most the task's `humanReviewTrials`; only records
 * of the current task definition and schema are offered. Each record is locked while it is updated.
 */
async function recordReviews(manifest: Map<string, FixtureSpec>): Promise<void> {
  const tasks = new Map((await loadScenarios([], true, manifest)).map((loaded) => [loaded.scenario.id, loaded]));
  const input = createInterface({ input: process.stdin, terminal: false });
  const lines = input[Symbol.asyncIterator]();
  const ask = async (question: string): Promise<string | null> => {
    process.stdout.write(question);
    const next = await lines.next();
    return next.done ? null : String(next.value).trim();
  };
  let recorded = 0;
  try {
    review: for (const file of (await readdir(RESULTS_DIR)).filter((name) => name.endsWith(".json")).sort()) {
      const path = join(RESULTS_DIR, file);
      const peek = await readRecord(path);
      if (peek?.schemaVersion !== RECORD_SCHEMA_VERSION || peek.scenarioKind !== "benchmark") continue;
      const task = tasks.get(peek.scenarioId);
      if (!task || task.hash !== peek.scenarioHash || task.scenario.kind !== "benchmark") continue;
      const sample = task.scenario.humanReviewTrials ?? 0;
      const pending = (record: BenchmarkRecord) => record.trials.filter((trial) => trial.trial <= sample && trial.humanReview === null);
      if (pending(peek).length === 0) continue;
      const holder = await acquireRecordLock(path);
      if (holder) {
        console.log(`skipped ${file}: locked by pid ${holder.pid} on ${holder.host}`);
        continue;
      }
      try {
        const stored = await readRecord(path);
        if (stored?.scenarioKind !== "benchmark") continue;
        let record: BenchmarkRecord = stored;
        for (const trial of pending(record)) {
          console.log(describeTrialForReview(record, trial, task.scenario.prompt));
          let verdict: string | null = null;
          while (verdict === null || !["p", "f", "s", "q"].includes(verdict)) {
            verdict = await ask("verdict [p]ass, [f]ail, [s]kip, [q]uit: ");
            if (verdict === null) break review;
          }
          if (verdict === "q") break review;
          if (verdict === "s") continue;
          const humanReview: HumanReview = {
            verdict: verdict === "p" ? "pass" : "fail",
            note: (await ask("note: ")) ?? "",
            reviewedAt: new Date().toISOString(),
          };
          const trials: BenchmarkTrialRecord[] = record.trials.map((kept) => (kept.trial === trial.trial ? { ...kept, humanReview } : kept));
          record = { ...record, updatedAt: new Date().toISOString(), trials };
          await writeRecord(path, record);
          recorded++;
        }
      } finally {
        await releaseRecordLock(path);
      }
    }
  } finally {
    input.close();
  }
  console.log(`\nrecorded ${recorded} human verdict(s)`);
}

// Artifacts with these extensions are redacted and scanned as text; any other artifact, such as a
// screenshot, is copied unchanged and listed for a human check before release.
const TEXT_ARTIFACT = /\.(?:txt|log|json|md|html?|csv|xml|svg|ya?ml)$/i;

/**
 * Writes a release of the current-schema benchmark records and their artifacts to an empty
 * directory: every string redacted, text artifacts redacted, other artifacts copied and listed for
 * a human check. The whole export is then scanned; any finding makes it not releasable and the run
 * exit non-zero. Local records are left untouched.
 */
async function exportRelease(target: string, scenarioIds: string[]): Promise<void> {
  const dir = resolve(target);
  // Compare real paths: on macOS the temp and results paths can differ only by a /private prefix.
  const results = await realpath(RESULTS_DIR);
  let existing = dir;
  while (!(await pathExists(existing)) && dirname(existing) !== existing) existing = dirname(existing);
  const real = join(await realpath(existing), relative(existing, dir));
  if (real === results || real.startsWith(`${results}/`)) throw new Error("--export must not write inside probes/results");
  if (await pathExists(dir) && (await readdir(dir)).length > 0) throw new Error(`--export target ${target} must be empty or absent`);
  await mkdir(dir, { recursive: true });
  const context: RedactionContext = { secrets: secretEnvValues(process.env), home: homedir(), user: userInfo().username, host: hostname() };

  const exported: string[] = [];
  const humanCheck: string[] = [];
  const textFiles: string[] = [];
  const findings: (SecretFinding & { file: string })[] = [];
  const fixtures = new Map<string, NonNullable<BenchmarkRecord["fixture"]>>();
  const artifactsRoot = await realpath(ARTIFACTS_DIR).catch(() => null);
  /** A stored artifact is exported only as a regular file inside results/artifacts, never through a link. */
  const safeArtifact = async (source: string): Promise<boolean> => {
    const info = await lstat(source).catch(() => null);
    if (!info?.isFile() || artifactsRoot === null) return false;
    return (await realpath(source)).startsWith(`${artifactsRoot}/`);
  };
  for (const file of (await readdir(RESULTS_DIR)).filter((name) => name.endsWith(".json")).sort()) {
    const record = await readRecord(join(RESULTS_DIR, file));
    if (record?.schemaVersion !== RECORD_SCHEMA_VERSION || record.scenarioKind !== "benchmark") continue;
    if (scenarioIds.length > 0 && !scenarioIds.includes(record.scenarioId)) continue;
    const name = redact(file, context);
    await writeFile(join(dir, name), `${JSON.stringify(redactJson(record, context), null, 2)}\n`);
    exported.push(name);
    textFiles.push(name);
    if (record.fixture) fixtures.set(record.fixture.name, record.fixture);
    for (const path of record.trials.flatMap((trial) => trial.rounds.flatMap((round) => round.artifacts))) {
      const released = redact(path, context);
      const source = join(RESULTS_DIR, path);
      const destination = resolve(dir, released);
      if (!destination.startsWith(`${dir}/`) || !(await safeArtifact(source))) {
        findings.push({ file: released, kind: "unsafe-artifact", line: 0 });
        continue;
      }
      await mkdir(dirname(destination), { recursive: true });
      if (TEXT_ARTIFACT.test(path)) {
        await writeFile(destination, redact(await readFile(source, "utf8"), context));
        textFiles.push(released);
      } else {
        await copyFile(source, destination);
        humanCheck.push(released);
      }
    }
  }

  for (const file of textFiles) {
    for (const finding of scanForSecrets(await readFile(join(dir, file), "utf8"), context)) findings.push({ file, ...finding });
  }
  // Release metadata is redacted and scanned too: a fixture repository can be a local or credentialed URL.
  const metadata = redactJson({
    exportedAt: new Date().toISOString(),
    runnerVersion: RUNNER_VERSION,
    schemaVersion: RECORD_SCHEMA_VERSION,
    boundary: BOUNDARY_STATEMENT,
    contamination: CONTAMINATION_STATEMENT,
    fixtures: [...fixtures.values()],
    records: exported,
    humanCheckBeforeRelease: humanCheck,
  }, context);
  for (const finding of scanForSecrets(JSON.stringify(metadata, null, 2), context)) findings.push({ file: "release.json", ...finding });
  const release = { ...metadata, scanFindings: findings, releasable: findings.length === 0 };
  await writeFile(join(dir, "release.json"), `${JSON.stringify(release, null, 2)}\n`);

  console.log(`exported ${exported.length} benchmark record(s) to ${dir}`);
  console.log(`boundary: ${BOUNDARY_STATEMENT}`);
  console.log(`contamination: ${CONTAMINATION_STATEMENT}`);
  // Artifact names come from verifier code the agent can influence.
  if (humanCheck.length > 0) console.log(terminalSafe(`\n${humanCheck.length} non-text artifact(s) need a human check before release:\n${humanCheck.map((path) => `  ${path}`).join("\n")}`));
  if (findings.length > 0) {
    console.log(`\nNOT RELEASABLE: ${findings.length} secret-like or unsafe finding(s):`);
    for (const finding of findings) console.log(terminalSafe(`  ${finding.file}${finding.line > 0 ? `:${finding.line}` : ""}: ${finding.kind}`));
    process.exitCode = 1;
  }
}

/** Provisions every manifest fixture, or only those of the named `--scenario` tasks. */
async function provisionFixtures(options: Options, manifest: Map<string, FixtureSpec>): Promise<void> {
  const specs = options.scenarioIds.length === 0
    ? [...manifest.values()]
    : (await loadScenarios(options.scenarioIds, true, manifest)).flatMap(({ fixtureSpec }) => (fixtureSpec ? [fixtureSpec] : []));
  const unique = [...new Map(specs.map((spec) => [spec.name, spec])).values()];
  if (unique.length === 0) {
    console.log("no pinned fixtures to provision");
    return;
  }
  for (const spec of unique) {
    console.error(`provisioning ${spec.name} at ${spec.commit.slice(0, 12)}`);
    console.log(`${spec.name} | ${await provisionFixture(spec)}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const manifest = await readFixtureManifest();
  if (options.provisionFixtures) {
    await provisionFixtures(options, manifest);
    return;
  }
  if (options.recordReview) {
    await recordReviews(manifest);
    return;
  }
  if (options.exportDir !== null) {
    await exportRelease(options.exportDir, options.scenarioIds);
    return;
  }
  const scenarios = await loadScenarios(options.scenarioIds, options.includeBenchmarks, manifest);
  // Keeps an idle Mac awake until this runner exits. It cannot stop lid-close sleep on battery,
  // which hostSleptSince turns into infrastructure failures instead.
  if (!options.dryRun && process.platform === "darwin" && Bun.which("caffeinate")) {
    // Unreferenced: caffeinate waits for this process, so it must not keep this process alive.
    Bun.spawn(["caffeinate", "-i", "-s", "-w", String(process.pid)], { stdio: ["ignore", "ignore", "ignore"] }).unref();
  }
  const variants = await resolveVariants(options);
  if (options.harnessMode === "whole") await verifyWholeHarnessLinks();
  const harnessHash = options.harnessMode === "whole" ? await effectivePiHarnessHash() : await isolatedHarnessHash();
  const runtime = await readRuntimeIdentity(options.harnessMode);
  const runtimeHash = options.harnessMode === "whole" ? runtimeFingerprint(runtime) : null;
  const needsModelCatalogue = !options.dryRun && scenarios.some(({ scenario }) => scenario.kind === "benchmark");
  const modelCatalogue = needsModelCatalogue ? await runMetadataCommand(["pi", "--list-models"], REPO_ROOT) : "";
  await mkdir(RESULTS_DIR, { recursive: true });

  // Memoized as promises: concurrent cells ask for the same files and must share one write.
  let promptDir: Promise<string> | null = null;
  const ensurePromptDir = (): Promise<string> => (promptDir ??= makeTemporaryDirectory("pi-probe-variants-"));
  const systemPromptFiles = new Map<string, Promise<string>>();
  const systemPromptFile = (variant: Variant, verifierNotice: string | undefined): Promise<string> => {
    const key = `${variant.instructionsHash}:${verifierNotice ?? ""}`;
    const existing = systemPromptFiles.get(key);
    if (existing) return existing;
    const written = (async () => {
      const suffix = verifierNotice ? "-verifier" : "";
      const file = join(await ensurePromptDir(), `${variant.instructionsHash.slice(0, 12)}${suffix}.md`);
      const notice = verifierNotice ? `\n\n${automaticVerifierNotice(verifierNotice)}\n` : "";
      await writeFile(file, `${variant.instructions}${notice}`);
      return file;
    })();
    systemPromptFiles.set(key, written);
    return written;
  };
  let judgeSystemPromptFile: Promise<string> | null = null;
  const ensureJudgeSystemPromptFile = (): Promise<string> => (judgeSystemPromptFile ??= (async () => {
    const file = join(await ensurePromptDir(), "judge-system.md");
    await writeFile(file, "You are a strict evaluator. Follow the output format exactly.\n");
    return file;
  })());

  type Cell = { loaded: LoadedScenario; model: string; variant: Variant };
  const cells: Cell[] = scenarios.flatMap((loaded) =>
    options.models.flatMap((model) => variants.map((variant) => ({ loaded, model, variant }))));
  let totalInfrastructureFailures = 0;
  let totalJudgeUnavailable = 0;
  // Runs or reports one record cell; null when an interruption stopped it.
  const runCell = async ({ loaded, model, variant }: Cell): Promise<string | null> => {
    const { scenario } = loaded;
    const key: RecordKey = {
      harnessMode: options.harnessMode,
      harnessHash,
      runtimeHash,
      scenarioId: scenario.id,
      model,
      instructionsHash: variant.instructionsHash,
      scenarioHash: loaded.hash,
      judgeModel: scenario.kind === "benchmark" && scenario.scoring === "verifier" ? null : options.judgeModel,
    };
    // An explicit --trials applies to guard scenarios too.
    const guard = scenario.guard === true && !options.trialsGiven;
    const wantFor = (record: ResultRecord | null) => ({ ...key, trials: trialTarget(record, options.trials, guard) });
    const path = join(RESULTS_DIR, recordFileName(key));
    const cell = `${scenario.id} | ${model} | ${variant.label}`;

    if (options.dryRun) {
      const cached = await readRecord(path);
      const comparable = cached && measuresSameSetup(cached, key) ? cached : null;
      const unjudged = comparable ? unavailableJudgements(comparable) : 0;
      const rejudge = unjudged > 0 ? `, would re-judge ${unjudged}` : "";
      const want = wantFor(comparable);
      if (comparable && isReusable(comparable, want)) {
        return `${cell} | cached${rejudge} | ${summarizeRecord(comparable)}`;
      }
      const toRun = missingTrials(comparable, want);
      const kept = toRun < want.trials ? ` (${want.trials - toRun} cached)` : "";
      const guardNote = guard && want.trials < options.trials ? `, guard: +${options.trials - want.trials} after a failure` : "";
      return `${cell} | would run ${toRun} trials${kept}${guardNote}${rejudge}`;
    }

    const holder = await acquireRecordLock(path);
    if (holder) {
      return `${cell} | skipped: locked by pid ${holder.pid} on ${holder.host} since ${holder.startedAt}`;
    }
    try {
      // Read only after locking, so trials another runner just saved are counted.
      const cached = await readRecord(path);
      const now = new Date().toISOString();
      const benchmarkDetails: BenchmarkDetails = {
        contextWindow: scenario.kind === "benchmark" ? parseContextWindow(modelCatalogue, model) : null,
        fixture: fixtureProvenance(loaded.fixtureSpec),
      };
      let record: ResultRecord = cached && measuresSameSetup(cached, key)
        ? { ...cached, runtime, variantLabel: variant.label, ...(cached.scenarioKind === "benchmark" ? benchmarkDetails : {}) }
        : newRecord(scenario, {
          schemaVersion: RECORD_SCHEMA_VERSION,
          runnerVersion: RUNNER_VERSION,
          ...key,
          runtime,
          variantLabel: variant.label,
          createdAt: now,
          updatedAt: now,
          infrastructureFailures: [],
        }, benchmarkDetails);

      // Retry judgements that failed earlier from the stored evidence; the agent run is not repeated.
      let rejudged = 0;
      if (record.scenarioKind !== "benchmark" && scenario.kind !== "benchmark") {
        let probeRecord = record;
        for (const [index, stored] of probeRecord.trials.entries()) {
          if (stored.judge.verdict !== "unavailable") continue;
          console.error(`re-judging ${cell} / trial ${stored.trial}`);
          const verdict = await judge(
            scenario,
            stored.finalMessage,
            stored.judgeEvidence,
            options.judgeModel,
            await ensureJudgeSystemPromptFile(),
          );
          if (shuttingDown) return null;
          if (verdict.verdict === "unavailable") continue;
          rejudged++;
          const trials = probeRecord.trials.map((trial, position) => (position === index ? { ...trial, judge: verdict } : trial));
          probeRecord = { ...probeRecord, updatedAt: new Date().toISOString(), trials };
          await writeRecord(path, probeRecord);
        }
        record = probeRecord;
      }
      if (record.scenarioKind === "benchmark") {
        let benchmarkRecord = record;
        for (const [index, stored] of benchmarkRecord.trials.entries()) {
          if (stored.outcome !== "unjudged") continue;
          console.error(`re-judging ${cell} / trial ${stored.trial}`);
          const answer = stored.rounds[stored.rounds.length - 1].finalMessage;
          const judgement = await judgeBenchmark(loaded, answer, options.judgeModel, await ensureJudgeSystemPromptFile());
          if (shuttingDown) return null;
          if (judgement.verdict !== "judged") continue;
          rejudged++;
          const trials = benchmarkRecord.trials.map((trial, position) =>
            (position === index ? { ...trial, judgement, outcome: judgedOutcome(judgement) } : trial));
          benchmarkRecord = { ...benchmarkRecord, updatedAt: new Date().toISOString(), trials };
          await writeRecord(path, benchmarkRecord);
        }
        record = benchmarkRecord;
      }
      const rejudgedPart = rejudged > 0 ? `, re-judged ${rejudged}` : "";

      let target = wantFor(record).trials;
      if (isReusable(record, wantFor(record))) {
        // Fixture notes do not key records, so a cache hit still saves refreshed provenance.
        if (cached?.scenarioKind === "benchmark" && JSON.stringify(cached.fixture) !== JSON.stringify(benchmarkDetails.fixture)) {
          // `record`, not `cached`: a re-judgement above must not be undone.
          await writeRecord(path, record);
        }
        totalJudgeUnavailable += unavailableJudgements(record);
        return `${cell} | cached${rejudgedPart} | ${summarizeRecord(record)}`;
      }
      let toRun = missingTrials(record, wantFor(record));
      const keptTrials = record.trials.length;
      let failuresThisRun = 0;

      for (let attempt = 1; attempt <= toRun; attempt++) {
        console.error(`running ${cell} / trial ${record.trials.length + 1} (attempt ${attempt} of ${toRun})`);
        const attempted = await runAndRecordTrial(record, {
          probe: async (probe) => runTrial({
            loaded,
            scenario: probe,
            model,
            judgeModel: options.judgeModel,
            judgeSystemPromptFile: await ensureJudgeSystemPromptFile(),
            systemPromptFile: await systemPromptFile(variant, probe.verifierNotice),
            harnessMode: options.harnessMode,
          }),
          benchmark: async (benchmark, trial) => {
            const artifactRoot = join(ARTIFACTS_DIR, recordFileName(key).replace(/\.json$/, ""), `trial-${trial}`);
            // Clears artifacts an interrupted attempt at this trial number left behind.
            await rm(artifactRoot, { recursive: true, force: true });
            const outcome = await runBenchmarkTrial({
              loaded,
              scenario: benchmark,
              model,
              systemPromptFile: await systemPromptFile(variant, undefined),
              harnessMode: options.harnessMode,
              judge: { model: options.judgeModel, systemPromptFile: await ensureJudgeSystemPromptFile() },
              artifactRoot,
            });
            if (outcome.kind === "infrastructure") await rm(artifactRoot, { recursive: true, force: true });
            return outcome;
          },
        }, scenario);
        // A child stopped by our own interruption is neither a verdict nor an infrastructure failure.
        if (shuttingDown) return null;
        record = attempted.record;
        if (attempted.failure) {
          failuresThisRun++;
          console.error(`infrastructure failure: ${attempted.failure.reason}`);
        } else {
          const latest = record.trials[record.trials.length - 1];
          if ("judge" in latest && latest.judge.verdict === "unavailable") console.error(`judge unavailable: ${latest.judge.reason}`);
          if ("judgement" in latest && latest.judgement && latest.judgement.verdict !== "judged") {
            console.error(`judge ${latest.judgement.verdict}: ${latest.judgement.reason}`);
          }
        }
        await writeRecord(path, record);
        // A failing guard trial raises the target, so the same run tops the cell up.
        const raised = wantFor(record).trials;
        if (raised > target) {
          console.error(`guard ${cell} failed a trial; topping up to ${raised}`);
          toRun += raised - target;
          target = raised;
        }
      }

      totalInfrastructureFailures += failuresThisRun;
      totalJudgeUnavailable += unavailableJudgements(record);
      const added = record.trials.length - keptTrials;
      const source = `${keptTrials > 0 ? `topped up +${added}` : `fresh ${added}`}${rejudgedPart}`;
      const shortfall = record.trials.length < target ? ` (${target - record.trials.length} short)` : "";
      const guardPart = guard && target < options.trials ? ", guard" : "";
      return `${cell} | ${source}${guardPart}${shortfall} | ${summarizeRecord(record, failuresThisRun)}`;
    } finally {
      await releaseRecordLock(path);
    }
  };

  // Cells hold separate records and locks, so they can run side by side. After an error no new
  // cell starts, but cells already running finish, so their paid trials are kept.
  const rows: (string | null)[] = new Array(cells.length).fill(null);
  let nextCell = 0;
  let firstError: unknown = null;
  const worker = async (): Promise<void> => {
    while (!shuttingDown && firstError === null && nextCell < cells.length) {
      const index = nextCell++;
      try {
        rows[index] = await runCell(cells[index]);
      } catch (error) {
        firstError ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, cells.length) }, worker));
  if (firstError !== null) throw firstError;
  if (shuttingDown) return;

  console.log(`\nharness mode: ${options.harnessMode} (${harnessHash.slice(0, 12)})`);
  const packages = runtime.packages ? `, packages ${runtime.packages.map((p) => `${p.source}@${p.version ?? "?"}`).join(", ") || "none"}` : "";
  const runtimePart = runtimeHash ? ` (${runtimeHash.slice(0, 12)})` : " (diagnostic only)";
  console.log(`runtime: pi ${runtime.piVersion}, thinking ${THINKING_LEVEL}${packages}${runtimePart}`);
  if (scenarios.some(({ scenario }) => scenario.kind === "benchmark")) {
    console.log(`boundary: ${BOUNDARY_STATEMENT}`);
    console.log(`contamination: ${CONTAMINATION_STATEMENT}`);
  }
  console.log(`scenario | model | variant | source | result`);
  for (const row of rows) if (row !== null) console.log(row);
  if (totalInfrastructureFailures > 0) {
    console.log(`\n${totalInfrastructureFailures} trial(s) failed for infrastructure reasons and were not scored; rerun to top up.`);
    process.exitCode = 1;
  }
  if (totalJudgeUnavailable > 0) {
    console.log(`\n${totalJudgeUnavailable} stored trial(s) have no judge verdict because the judge failed or answered outside its format; rerun to re-judge them.`);
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  if (!shuttingDown) await releaseResources();
}
