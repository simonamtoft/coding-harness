/**
 * Launch a probe run in the background and wait for it without fixed sleeps (PI-97).
 *
 *   bun probes/background.ts start <run-dir> [-- <run.ts args>]
 *   bun probes/background.ts wait <run-dir> [--max-seconds N] [--from-byte N]
 *
 * `start` creates <run-dir> exclusively, so a directory names at most one job, and returns once a
 * detached supervisor is running `bun probes/run.ts`. The supervisor sends the runner's stdout and
 * stderr to <run-dir>/run.log and writes <run-dir>/exit when the runner ends. `wait` streams new
 * log output and returns as soon as the run ends, or after --max-seconds with the run untouched.
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROBES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PROBES_DIR, "..");
const RUNNER = join(PROBES_DIR, "run.ts");

const LOG_FILE = "run.log";
const EXIT_FILE = "exit";
const PID_FILE = "supervisor.pid";

const STILL_RUNNING_EXIT = 75;
const DEFAULT_MAX_SECONDS = 300;
const POLL_MS = 1000;
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

type ExitRecord = { code: number | null; signal: string | null; finishedAt: string };

function fail(message: string): never {
  console.error(`background: ${message}`);
  process.exit(2);
}

function writeAtomically(path: string, content: string): void {
  writeFileSync(`${path}.tmp`, content);
  renameSync(`${path}.tmp`, path);
}

function start(runDir: string, runnerArgs: string[]): void {
  mkdirSync(dirname(runDir), { recursive: true });
  try {
    mkdirSync(runDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") fail(`${runDir} already exists; choose a new run directory`);
    throw error;
  }
  const supervisor = spawn(process.execPath, [fileURLToPath(import.meta.url), "supervise", runDir, "--", ...runnerArgs], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
  });
  if (supervisor.pid === undefined) fail("could not start the supervisor");
  writeAtomically(join(runDir, PID_FILE), `${supervisor.pid}\n`);
  supervisor.unref();
  console.log(`started probe run in ${runDir} (supervisor pid ${supervisor.pid})`);
  console.log(`wait: bun probes/background.ts wait ${runDir}`);
}

function supervise(runDir: string, runnerArgs: string[]): void {
  const log = openSync(join(runDir, LOG_FILE), "a");
  const runner = spawn(process.execPath, [RUNNER, ...runnerArgs], { cwd: REPO_ROOT, stdio: ["ignore", log, log] });
  closeSync(log);
  // The runner owns cleanup on these signals; the supervisor only passes them on and records the outcome.
  for (const signal of FORWARDED_SIGNALS) process.on(signal, () => runner.kill(signal));
  const record = (code: number | null, signal: string | null) => {
    const exit: ExitRecord = { code, signal, finishedAt: new Date().toISOString() };
    writeAtomically(join(runDir, EXIT_FILE), `${JSON.stringify(exit)}\n`);
    process.exit(0);
  };
  runner.on("exit", (code, signal) => record(code, signal));
  runner.on("error", (error) => {
    writeFileSync(join(runDir, LOG_FILE), `background: could not start the runner: ${error.message}\n`, { flag: "a" });
    record(null, null);
  });
}

function readExit(runDir: string): ExitRecord | null {
  const path = join(runDir, EXIT_FILE);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as ExitRecord : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Writes log bytes from `offset` to stdout and returns the new offset. */
function printLogFrom(runDir: string, offset: number): number {
  const path = join(runDir, LOG_FILE);
  if (!existsSync(path)) return offset;
  const size = statSync(path).size;
  if (size <= offset) return offset;
  const buffer = Buffer.alloc(size - offset);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, offset);
  } finally {
    closeSync(fd);
  }
  process.stdout.write(buffer);
  return size;
}

async function wait(runDir: string, maxSeconds: number, fromByte: number): Promise<number> {
  const pidPath = join(runDir, PID_FILE);
  if (!existsSync(pidPath)) fail(`${runDir} has no ${PID_FILE}; was it created by \`start\`?`);
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  const deadline = Date.now() + maxSeconds * 1000;
  let offset = fromByte;
  for (;;) {
    // Read the exit file before liveness so a supervisor that just finished is not reported lost.
    const exit = readExit(runDir);
    offset = printLogFrom(runDir, offset);
    if (exit !== null) {
      const status = exit.code ?? 1;
      const outcome = exit.code !== null ? `exit ${exit.code}` : exit.signal !== null ? `signal ${exit.signal}` : "runner failed to start";
      console.log(`\n[background] finished: ${outcome} at ${exit.finishedAt}; log ${join(runDir, LOG_FILE)}`);
      return status;
    }
    if (!isAlive(pid) && readExit(runDir) === null) {
      offset = printLogFrom(runDir, offset);
      console.log(`\n[background] lost: supervisor ${pid} is gone without recording an exit; the run's outcome is unknown`);
      return 1;
    }
    if (Date.now() >= deadline) {
      console.log(`\n[background] running: still going after ${maxSeconds}s; resume with: ` +
        `bun probes/background.ts wait ${runDir} --from-byte ${offset}`);
      return STILL_RUNNING_EXIT;
    }
    await Bun.sleep(POLL_MS);
  }
}

function parseNonNegative(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isInteger(parsed) || parsed < 0) fail(`${flag} needs a non-negative integer`);
  return parsed;
}

const [command, runDirArg, ...rest] = process.argv.slice(2);
if (runDirArg === undefined || !["start", "supervise", "wait"].includes(command ?? "")) {
  fail("usage: bun probes/background.ts start <run-dir> [-- <run.ts args>] | wait <run-dir> [--max-seconds N] [--from-byte N]");
}
const runDir = resolve(runDirArg);

if (command === "start" || command === "supervise") {
  if (rest.length > 0 && rest[0] !== "--") fail(`put run.ts arguments after --, got ${rest[0]}`);
  const runnerArgs = rest.slice(1);
  if (command === "start") start(runDir, runnerArgs);
  else supervise(runDir, runnerArgs);
} else {
  let maxSeconds = DEFAULT_MAX_SECONDS;
  let fromByte = 0;
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] === "--max-seconds") maxSeconds = parseNonNegative("--max-seconds", rest[i + 1]);
    else if (rest[i] === "--from-byte") fromByte = parseNonNegative("--from-byte", rest[i + 1]);
    else fail(`unknown option ${rest[i]}`);
  }
  process.exitCode = await wait(runDir, maxSeconds, fromByte);
}
