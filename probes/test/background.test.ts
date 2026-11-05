/**
 * Offline checks for probes/background.ts. The helper is copied next to a fake probes/run.ts, so
 * no runner, model, or judge is involved.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "../background.ts");
const TEST_TIMEOUT_MS = 20_000;

// Prints progress, optionally blocks until FAKE_RELEASE exists, then exits with FAKE_EXIT.
const FAKE_RUNNER = `
console.error("running cell / trial 1");
const release = process.env.FAKE_RELEASE;
if (release) while (!(await Bun.file(release).exists())) await Bun.sleep(50);
console.error("running cell / trial 2");
if (process.env.FAKE_EXIT !== "0") console.error("infrastructure failure: fake child exited 1");
console.log("args: " + process.argv.slice(2).join(" "));
process.exit(Number(process.env.FAKE_EXIT));
`;

let base: string;
let helper: string;
let runDir: string;
let release: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "probe-background-test-"));
  mkdirSync(join(base, "probes"));
  helper = join(base, "probes/background.ts");
  copyFileSync(SOURCE, helper);
  writeFileSync(join(base, "probes/run.ts"), FAKE_RUNNER);
  runDir = join(base, "runs/pilot");
  release = join(base, "release");
});

afterEach(() => {
  writeFileSync(release, "");
  rmSync(base, { recursive: true, force: true });
});

async function helperCall(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", helper, ...args], {
    env: { ...process.env, FAKE_EXIT: "0", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("wait streams progress and returns the run's success promptly", async () => {
  const started = await helperCall(["start", runDir, "--", "--trials", "1"]);
  expect(started.exitCode).toBe(0);

  const began = Date.now();
  const waited = await helperCall(["wait", runDir, "--max-seconds", "15"]);
  expect(Date.now() - began).toBeLessThan(10_000);
  expect(waited.exitCode).toBe(0);
  expect(waited.stdout).toContain("running cell / trial 2");
  expect(waited.stdout).toContain("args: --trials 1");
  expect(waited.stdout).toContain("[background] finished: exit 0");
}, TEST_TIMEOUT_MS);

test("wait reports a failed run with its exit status and failure output", async () => {
  await helperCall(["start", runDir], { FAKE_EXIT: "3" });

  const waited = await helperCall(["wait", runDir, "--max-seconds", "15"]);
  expect(waited.exitCode).toBe(3);
  expect(waited.stdout).toContain("infrastructure failure: fake child exited 1");
  expect(waited.stdout).toContain("[background] finished: exit 3");
}, TEST_TIMEOUT_MS);

test("a bounded wait leaves the run going and resumes without repeating output", async () => {
  await helperCall(["start", runDir], { FAKE_RELEASE: release });

  const first = await helperCall(["wait", runDir, "--max-seconds", "1"]);
  expect(first.exitCode).toBe(75);
  expect(first.stdout).toContain("[background] running:");
  expect(first.stdout).toContain("running cell / trial 1");
  const offset = first.stdout.match(/--from-byte (\d+)/)?.[1];
  expect(offset).toBeDefined();

  writeFileSync(release, "");
  const second = await helperCall(["wait", runDir, "--max-seconds", "15", "--from-byte", offset!]);
  expect(second.exitCode).toBe(0);
  expect(second.stdout).not.toContain("trial 1");
  expect(second.stdout).toContain("running cell / trial 2");
}, TEST_TIMEOUT_MS);

test("start refuses an existing run directory and leaves its job alone", async () => {
  await helperCall(["start", runDir], { FAKE_RELEASE: release });

  const duplicate = await helperCall(["start", runDir]);
  expect(duplicate.exitCode).toBe(2);
  expect(duplicate.stderr).toContain("already exists");

  writeFileSync(release, "");
  const waited = await helperCall(["wait", runDir, "--max-seconds", "15"]);
  expect(waited.exitCode).toBe(0);
  expect(waited.stdout.match(/running cell \/ trial 1/g)).toHaveLength(1);
}, TEST_TIMEOUT_MS);

test("wait reports a supervisor that died without recording an exit", async () => {
  await helperCall(["start", runDir], { FAKE_RELEASE: release });
  const pid = Number(readFileSync(join(runDir, "supervisor.pid"), "utf8"));
  process.kill(pid, "SIGKILL");

  const waited = await helperCall(["wait", runDir, "--max-seconds", "15"]);
  expect(waited.exitCode).toBe(1);
  expect(waited.stdout).toContain("[background] lost:");
  expect(existsSync(join(runDir, "exit"))).toBe(false);
}, TEST_TIMEOUT_MS);
