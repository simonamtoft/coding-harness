/**
 * Stand-in for the `pi` executable in the offline runner lifecycle suite. Behavior comes from
 * environment variables set by runner.test.ts:
 *
 * - FAKE_MODE (agent calls): ok | exit | incomplete | hang | ignore-term | slow-after-first
 * - FAKE_JUDGE: ok | exit
 * - FAKE_LOG: append one line per model call
 * - FAKE_PIDFILE: where hang modes write the pid of the grandchild they start
 * - FAKE_MARK: marker file for slow-after-first
 * - FAKE_PACKAGE: resolved path printed by `pi list`
 */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("0.0.0-fake");
  process.exit(0);
}
if (args[0] === "list") {
  console.log(`User packages:\n  ../../plugins/demo-pkg\n    ${process.env.FAKE_PACKAGE}`);
  process.exit(0);
}

const prompt = args[args.length - 1];
const isJudge = prompt.startsWith("You are scoring");
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : "unset");
if (process.env.FAKE_LOG) {
  appendFileSync(
    process.env.FAKE_LOG,
    `${isJudge ? "judge" : "agent"} thinking=${flag("--thinking")} registry=${process.env.npm_config_registry ?? "unset"}\n`,
  );
}

const emit = (event: unknown) => console.log(JSON.stringify(event));
const finish = (text: string, stopReason = "stop") => {
  emit({ type: "turn_end", message: { role: "assistant", stopReason, content: [{ type: "text", text }] } });
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
  finish("PASS - fake judge");
  process.exit(0);
}

emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "bun test test/charge.test.ts" } });
emit({ type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: { content: [{ type: "text", text: "2 pass" }] }, isError: false });

let mode = process.env.FAKE_MODE ?? "ok";
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
finish("done");
