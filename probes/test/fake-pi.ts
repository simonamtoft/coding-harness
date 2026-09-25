/**
 * Stand-in for the `pi` executable in the offline runner lifecycle suite. Behavior comes from
 * environment variables set by runner.test.ts:
 *
 * - FAKE_MODE (agent calls): ok | exit | incomplete | hang | ignore-term | slow-after-first
 * - FAKE_JUDGE: ok | exit
 * - FAKE_JUDGE_REPLY: the judge's final message (default `PASS - fake judge`)
 * - FAKE_LOG: append one line per model call
 * - FAKE_PIDFILE: where hang modes write the pid of the grandchild they start
 * - FAKE_MARK: marker file for slow-after-first
 * - FAKE_PACKAGE: resolved path printed by `pi list`
 * - FAKE_INPUT, FAKE_COST: input tokens and dollar cost reported by each assistant message_end
 * - FAKE_USAGE=missing: assistant messages carry no usage
 * - FAKE_FIRST_ERROR: the first assistant message_end fails with this provider error
 * - FAKE_FINAL: the agent's final message (default `done`)
 * - FAKE_CALLS: counter file numbering agent calls; required by FAKE_FIX_AT and FAKE_EXIT_AT
 * - FAKE_FIX_AT: on this agent call, write FAKE_FIX_CONTENT (default `ok`) to FAKE_FIX_PATH
 *   (default fixed.txt) in the working directory
 * - FAKE_SNAPSHOT: append one JSON line per agent call describing what the agent can see: files
 *   (excluding .git), commit count, `git status --porcelain`, and the content of FAKE_SNAPSHOT_READ
 * - FAKE_EXIT_AT: on this agent call, behave like FAKE_MODE=exit
 * - FAKE_PROMPTS: append each agent prompt
 * - FAKE_HANDOFF: content written to the requested handoff file when a prompt asks for one
 * - FAKE_SESSIONS: append each agent call's --session-dir
 * - FAKE_SPANS, FAKE_DELAY_MS: append `start <model>` and `end <model>` around a sleep of
 *   FAKE_DELAY_MS on each agent call, so a test can see whether calls overlapped
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("0.0.0-fake");
  process.exit(0);
}
if (args[0] === "--list-models") {
  console.log("provider  model  context  max-out  thinking  images\nfake      bench  200K     8K       no        no");
  process.exit(0);
}
if (args[0] === "list") {
  console.log(`User packages:\n  ../../plugins/demo-pkg\n    ${process.env.FAKE_PACKAGE}`);
  process.exit(0);
}

const prompt = args[args.length - 1];
const isJudge = prompt.startsWith("You are scoring");
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : "unset");
const session = args.includes("--session-dir")
  ? ` session=${args.includes("--continue") ? "continue" : "new"}${args.includes("--no-session") ? "+no-session" : ""}`
  : "";
if (process.env.FAKE_LOG) {
  appendFileSync(
    process.env.FAKE_LOG,
    `${isJudge ? "judge" : "agent"} thinking=${flag("--thinking")} registry=${process.env.npm_config_registry ?? "unset"}${session}\n`,
  );
}

const emit = (event: unknown) => console.log(JSON.stringify(event));
const input = Number(process.env.FAKE_INPUT ?? 1000);
const cost = Number(process.env.FAKE_COST ?? 0.01);
const usage = process.env.FAKE_USAGE === "missing" ? undefined : {
  input, output: 100, cacheRead: 4000, cacheWrite: 0, totalTokens: input + 4100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
};
const assistantMessage = (content: unknown[], stopReason: string) => ({ role: "assistant", stopReason, content, usage });
const finish = (text: string, stopReason = "stop") => {
  const message = assistantMessage([{ type: "text", text }], stopReason);
  emit({ type: "message_end", message });
  emit({ type: "turn_end", message });
  emit({ type: "agent_end", messages: [], willRetry: false });
};
const startGrandchild = (detached: boolean) => {
  const child = Bun.spawn(["sleep", "60"], { detached, stdio: ["ignore", "ignore", "ignore"] });
  if (process.env.FAKE_PIDFILE) writeFileSync(process.env.FAKE_PIDFILE, String(child.pid));
};

if (isJudge) {
  if (process.env.FAKE_JUDGE === "exit") {
    console.error("judge provider down");
    process.exit(2);
  }
  finish(process.env.FAKE_JUDGE_REPLY ?? "PASS - fake judge");
  process.exit(0);
}

let call = 0;
if (process.env.FAKE_CALLS) {
  call = (existsSync(process.env.FAKE_CALLS) ? Number(readFileSync(process.env.FAKE_CALLS, "utf8")) : 0) + 1;
  writeFileSync(process.env.FAKE_CALLS, String(call));
}
if (process.env.FAKE_PROMPTS) appendFileSync(process.env.FAKE_PROMPTS, `${prompt}\n---\n`);
if (process.env.FAKE_SESSIONS) appendFileSync(process.env.FAKE_SESSIONS, `${flag("--session-dir")}\n`);
if (process.env.FAKE_SPANS) {
  appendFileSync(process.env.FAKE_SPANS, `start ${flag("--model")}\n`);
  await Bun.sleep(Number(process.env.FAKE_DELAY_MS ?? 0));
  appendFileSync(process.env.FAKE_SPANS, `end ${flag("--model")}\n`);
}
const handoffFile = /Write a handoff note to (\S+) in the project root/.exec(prompt)?.[1];
if (handoffFile && process.env.FAKE_HANDOFF) writeFileSync(handoffFile, process.env.FAKE_HANDOFF);
if (process.env.FAKE_SNAPSHOT) {
  const git = (...gitArgs: string[]) => Bun.spawnSync(["git", ...gitArgs], { stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
  const files: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, `${path}/`);
      else files.push(path);
    }
  };
  walk(".", "");
  files.sort();
  const readPath = process.env.FAKE_SNAPSHOT_READ;
  appendFileSync(process.env.FAKE_SNAPSHOT, `${JSON.stringify({
    files,
    commits: git("rev-list", "--count", "HEAD"),
    status: git("status", "--porcelain"),
    read: readPath && existsSync(readPath) ? readFileSync(readPath, "utf8") : null,
  })}\n`);
}
if (String(call) === process.env.FAKE_FIX_AT) {
  const fixPath = process.env.FAKE_FIX_PATH ?? "fixed.txt";
  mkdirSync(dirname(fixPath), { recursive: true });
  writeFileSync(fixPath, process.env.FAKE_FIX_CONTENT ?? "ok\n");
}

emit({
  type: "message_end",
  message: process.env.FAKE_FIRST_ERROR
    ? { ...assistantMessage([], "error"), errorMessage: process.env.FAKE_FIRST_ERROR }
    : assistantMessage([], "toolUse"),
});
emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "bun test test/charge.test.ts" } });
emit({ type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: { content: [{ type: "text", text: "2 pass" }] }, isError: false });

let mode = String(call) === process.env.FAKE_EXIT_AT ? "exit" : process.env.FAKE_MODE ?? "ok";
if (mode === "slow-after-first") {
  mode = existsSync(process.env.FAKE_MARK!) ? "hang" : "ok";
  writeFileSync(process.env.FAKE_MARK!, "1");
}

switch (mode) {
  case "exit":
    console.error("provider auth failed");
    process.exit(3);
  case "incomplete":
    finish("", "error");
    process.exit(0);
  case "hang":
    startGrandchild(false);
    await Bun.sleep(60_000);
    break;
  case "ignore-term":
    // Like Pi's Bash tool: the grandchild gets a process group of its own.
    process.on("SIGTERM", () => undefined);
    startGrandchild(true);
    await Bun.sleep(60_000);
    break;
}
finish(process.env.FAKE_FINAL ?? "done");
