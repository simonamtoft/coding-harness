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
import { mkdtemp, mkdir, cp, readdir, readFile, realpath, writeFile, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateAssertions } from "./lib/assertions.ts";
import { isReusable, missingTrials, recordFileName, RUNNER_VERSION } from "./lib/cache.ts";
import { hashFileSet, hashScenario, sha256Hex } from "./lib/hashing.ts";
import { judgePrompt, parseJudgeVerdict } from "./lib/judge.ts";
import { parseScenario } from "./lib/scenario.ts";
import { parseProbeRun, type ProbeRun } from "./lib/transcript.ts";
import { automaticVerifierNotice } from "../pi/agent/extensions/verify-turn/notice.ts";
import type { HarnessMode, ResultRecord, Scenario, TrialRecord } from "./lib/types.ts";

const PROBES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PROBES_DIR, "..");
const SCENARIOS_DIR = join(PROBES_DIR, "scenarios");
const RESULTS_DIR = join(PROBES_DIR, "results");
const INSTRUCTIONS_PATH = "shared/AGENTS.md";

const DEFAULT_MODELS = ["anthropic/claude-sonnet-5", "openai-codex/gpt-5.6-luna"];
const DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-5";
const DEFAULT_TRIALS = 3;
const SANDBOX_EXTENSION_PATH = "pi/agent/extensions/sandbox/index.ts";

const EFFECTIVE_PI_HARNESS_DIRECTORIES = [
  "pi/agent/agents",
  "pi/agent/extensions",
  "pi/agent/prompts",
  "shared/skills",
] as const;
const EFFECTIVE_PI_HARNESS_FILES = ["pi/agent/mcp.json", "pi/agent/packages.txt"] as const;
const INSTALLED_PI_LINKS = [
  ["agents", "pi/agent/agents"],
  ["extensions", "pi/agent/extensions"],
  ["prompts", "pi/agent/prompts"],
  ["skills", "shared/skills"],
  ["mcp.json", "pi/agent/mcp.json"],
] as const;

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

async function verifyWholeHarnessLinks(): Promise<void> {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
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
  for (const path of directFiles) files.set(path, await readFile(join(REPO_ROOT, path)));
  return hashFileSet(files);
}

function effectivePiHarnessHash(): Promise<string> {
  return canonicalHarnessHash(EFFECTIVE_PI_HARNESS_DIRECTORIES, EFFECTIVE_PI_HARNESS_FILES);
}

function isolatedHarnessHash(): Promise<string> {
  return canonicalHarnessHash(["pi/agent/extensions/sandbox"], []);
}

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

async function runPi(args: {
  model: string;
  systemPromptFile: string;
  prompt: string;
  cwd: string;
  withTools: boolean;
  harnessMode: HarnessMode;
}): Promise<ProbeRun> {
  const argv = [
    "pi", "-p", "--mode", "json",
    "--model", args.model,
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

  const proc = Bun.spawn(argv, { cwd: args.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const run = parseProbeRun(out);
  if (run.finalMessage === "") {
    throw new Error(`pi produced no final message for model ${args.model}: ${err.trim().slice(0, 500)}`);
  }
  return run;
}

async function runCommand(command: string[], cwd: string): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, output: `${out}${err}`.trim() };
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

async function runTrial(args: {
  loaded: LoadedScenario;
  model: string;
  judgeModel: string;
  judgeSystemPromptFile: string;
  trial: number;
  systemPromptFile: string;
  harnessMode: HarnessMode;
}): Promise<TrialRecord> {
  const { loaded, model, judgeModel, judgeSystemPromptFile, trial, systemPromptFile, harnessMode } = args;
  const { scenario } = loaded;

  if (scenario.kind === "single-turn") {
    const run = await runPi({ model, systemPromptFile, prompt: scenario.prompt, cwd: REPO_ROOT, withTools: false, harnessMode });
    const judged = await judge(scenario, run.finalMessage, null, judgeModel, judgeSystemPromptFile);
    return { trial, assertions: null, judge: judged, commands: run.commands, finalMessage: run.finalMessage };
  }

  const workDir = await mkdtemp(join(tmpdir(), `pi-probe-${scenario.id}-`));
  await cp(join(loaded.dir, "fixture"), workDir, { recursive: true });

  const before = await runCommand(scenario.checkCommand!, workDir);
  if (before.exitCode !== 0) {
    throw new Error(`scenario ${scenario.id}: fixture check must pass before the run\n${before.output}`);
  }

  const run = await runPi({ model, systemPromptFile, prompt: scenario.prompt, cwd: workDir, withTools: true, harnessMode });
  const after = await runCommand(scenario.checkCommand!, workDir);
  const assertions = evaluateAssertions(scenario.assertions ?? {}, {
    checkExitCode: after.exitCode,
    changedFiles: await changedFixtureFiles(workDir, loaded.fixture),
    commands: run.commands,
  });
  const reported = scenario.reportCommand ? await runCommand(scenario.reportCommand, workDir) : null;
  const checkEvidence = [
    `${scenario.checkCommand!.join(" ")} exited ${after.exitCode}:\n${after.output}`,
    reported ? `${scenario.reportCommand!.join(" ")} exited ${reported.exitCode}:\n${reported.output}` : null,
    `commands the agent ran: ${run.commands.length === 0 ? "none" : run.commands.join(" | ")}`,
  ].filter((part): part is string => part !== null).join("\n\n");
  const judged = await judge(scenario, run.finalMessage, checkEvidence, judgeModel, judgeSystemPromptFile);
  return { trial, assertions, judge: judged, commands: run.commands, finalMessage: run.finalMessage };
}

/** The judge never sees an instruction variant; it scores behavior, not compliance wording. */
async function judge(
  scenario: Scenario,
  finalMessage: string,
  checkOutput: string | null,
  judgeModel: string,
  judgeSystemPromptFile: string,
): Promise<TrialRecord["judge"]> {
  const run = await runPi({
    model: judgeModel,
    systemPromptFile: judgeSystemPromptFile,
    prompt: judgePrompt(scenario, finalMessage, checkOutput),
    cwd: REPO_ROOT,
    withTools: false,
    harnessMode: "isolated",
  });
  return parseJudgeVerdict(run.finalMessage);
}

function summarize(record: ResultRecord): string {
  const passes = record.trials.filter((t) => t.judge.verdict === "pass").length;
  const assertionPasses = record.trials.filter((t) => t.assertions?.passed === true).length;
  const assertionTotal = record.trials.filter((t) => t.assertions !== null).length;
  const assertionPart = assertionTotal > 0 ? ` assertions ${assertionPasses}/${assertionTotal}` : "";
  return `judge ${passes}/${record.trials.length}${assertionPart}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const scenarios = await loadScenarios(options.scenarioIds);
  const variants = await resolveVariants(options);
  if (options.harnessMode === "whole") await verifyWholeHarnessLinks();
  const harnessHash = options.harnessMode === "whole" ? await effectivePiHarnessHash() : await isolatedHarnessHash();
  await mkdir(RESULTS_DIR, { recursive: true });

  const variantDir = await mkdtemp(join(tmpdir(), "pi-probe-variants-"));
  const systemPromptFiles = new Map<string, string>();
  const systemPromptFile = async (variant: Variant, verifierNotice: string | undefined): Promise<string> => {
    const key = `${variant.instructionsHash}:${verifierNotice ?? ""}`;
    const existing = systemPromptFiles.get(key);
    if (existing) return existing;
    const suffix = verifierNotice ? "-verifier" : "";
    const file = join(variantDir, `${variant.instructionsHash.slice(0, 12)}${suffix}.md`);
    const notice = verifierNotice ? `\n\n${automaticVerifierNotice(verifierNotice)}\n` : "";
    await writeFile(file, `${variant.instructions}${notice}`);
    systemPromptFiles.set(key, file);
    return file;
  };
  const judgeSystemPromptFile = join(variantDir, "judge-system.md");
  await writeFile(judgeSystemPromptFile, "You are a strict evaluator. Follow the output format exactly.\n");

  const rows: string[] = [];
  for (const loaded of scenarios) {
    for (const model of options.models) {
      for (const variant of variants) {
        const key = {
          harnessMode: options.harnessMode,
          harnessHash,
          scenarioId: loaded.scenario.id,
          model,
          instructionsHash: variant.instructionsHash,
          scenarioHash: loaded.hash,
          judgeModel: options.judgeModel,
        };
        const path = join(RESULTS_DIR, recordFileName(key));
        const cached = await readFile(path, "utf8").then((text) => JSON.parse(text) as ResultRecord, () => null);
        const want = { ...key, trials: options.trials };

        if (cached && isReusable(cached, want)) {
          rows.push(`${loaded.scenario.id} | ${model} | ${variant.label} | cached | ${summarize(cached)}`);
          continue;
        }
        const keptTrials = cached && missingTrials(cached, want) < options.trials ? cached.trials : [];
        const toRun = missingTrials(cached, want);
        if (options.dryRun) {
          const kept = keptTrials.length > 0 ? ` (${keptTrials.length} cached)` : "";
          rows.push(`${loaded.scenario.id} | ${model} | ${variant.label} | would run ${toRun} trials${kept}`);
          continue;
        }

        const trials: TrialRecord[] = [...keptTrials];
        for (let trial = keptTrials.length + 1; trial <= options.trials; trial++) {
          console.error(`running ${loaded.scenario.id} / ${model} / ${variant.label} / trial ${trial}`);
          trials.push(await runTrial({
            loaded,
            model,
            judgeModel: options.judgeModel,
            judgeSystemPromptFile,
            trial,
            systemPromptFile: await systemPromptFile(variant, loaded.scenario.verifierNotice),
            harnessMode: options.harnessMode,
          }));
        }
        const record: ResultRecord = {
          runnerVersion: RUNNER_VERSION,
          harnessMode: options.harnessMode,
          harnessHash,
          scenarioId: loaded.scenario.id,
          scenarioHash: loaded.hash,
          instructionsHash: variant.instructionsHash,
          variantLabel: variant.label,
          model,
          judgeModel: options.judgeModel,
          createdAt: new Date().toISOString(),
          trials,
        };
        await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
        const source = keptTrials.length > 0 ? `topped up +${toRun}` : "fresh";
        rows.push(`${loaded.scenario.id} | ${model} | ${variant.label} | ${source} | ${summarize(record)}`);
      }
    }
  }

  console.log(`\nharness mode: ${options.harnessMode} (${harnessHash.slice(0, 12)})`);
  console.log(`scenario | model | variant | source | result`);
  for (const row of rows) console.log(row);
}

await main();
