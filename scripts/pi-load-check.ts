/**
 * Model-free startup check of the installed Pi harness. Starts `pi` in RPC mode, asks for the
 * registered commands, and fails when the installed resources do not link to this checkout, an
 * extension fails to load, or a canonical skill or prompt template is not registered from this
 * checkout. It makes no model call, so it cannot show how the harness behaves; paid probes do that.
 *
 * Usage: bun scripts/pi-load-check.ts
 */
import { readdir, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STARTUP_TIMEOUT_MS = 30_000;
const INSTALLED_PI_LINKS = [
  ["AGENTS.md", "shared/AGENTS.md"],
  ["agents", "pi/agent/agents"],
  ["extensions", "pi/agent/extensions"],
  ["prompts", "pi/agent/prompts"],
  ["skills", "shared/skills"],
  ["mcp.json", "pi/agent/mcp.json"],
] as const;

type Command = { name: string; source: string; sourceInfo?: { path?: string } };

async function linkProblems(): Promise<string[]> {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const problems: string[] = [];
  for (const [installedName, canonicalName] of INSTALLED_PI_LINKS) {
    const installed = join(agentDir, installedName);
    const canonical = join(REPO_ROOT, canonicalName);
    if ((await realpath(installed).catch(() => null)) !== (await realpath(canonical))) {
      problems.push(`${installed} does not link to ${canonical}; run ./link.sh`);
    }
  }
  return problems;
}

async function canonicalCommands(): Promise<Map<string, string>> {
  const expected = new Map<string, string>();
  const skills = join(REPO_ROOT, "shared/skills");
  for (const entry of await readdir(skills, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(skills, entry.name, "SKILL.md"))) {
      expected.set(`skill:${entry.name}`, join(skills, entry.name, "SKILL.md"));
    }
  }
  const prompts = join(REPO_ROOT, "pi/agent/prompts");
  for (const name of await readdir(prompts)) {
    if (name.endsWith(".md")) expected.set(name.slice(0, -".md".length), join(prompts, name));
  }
  return expected;
}

/** Starts Pi outside any project, so project-local resources cannot mask the installed ones. */
async function registeredCommands(): Promise<{ commands: Command[] | null; stderr: string }> {
  const proc = Bun.spawn(["pi", "--mode", "rpc", "--no-session", "--offline", "--no-approve"], {
    cwd: process.env.TMPDIR ?? "/tmp",
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderrText = new Response(proc.stderr).text();
  proc.stdin.write(`${JSON.stringify({ type: "get_commands", id: "load-check" })}\n`);
  proc.stdin.flush();

  const timer = setTimeout(() => proc.kill("SIGKILL"), STARTUP_TIMEOUT_MS);
  let commands: Command[] | null = null;
  let buffered = "";
  const decoder = new TextDecoder();
  try {
    for await (const chunk of proc.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      const response = lines.map(parseLine).find((event) => event?.id === "load-check");
      if (!response) continue;
      const listed = (response.data as { commands?: unknown } | undefined)?.commands;
      // Pi's RPC protocol types each entry as a Command; only the array shape is checked here.
      commands = response.success === true && Array.isArray(listed) ? listed as Command[] : null;
      // Closing stdin ends RPC mode; stdout keeps draining so Pi never writes to a closed pipe.
      proc.stdin.end();
    }
    await proc.exited;
  } finally {
    clearTimeout(timer);
  }
  return { commands, stderr: await stderrText };
}

function parseLine(line: string): { id?: unknown; success?: unknown; data?: unknown } | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function failed(problems: string[]): number {
  console.error(`Pi harness load check failed:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  return 1;
}

async function main(): Promise<number> {
  const broken = await linkProblems();
  if (broken.length > 0) return failed(broken);

  const { commands, stderr } = await registeredCommands();
  if (commands === null) {
    const detail = stderr.trim() ? `:\n${stderr.trim()}` : "";
    return failed([`pi exited or passed ${STARTUP_TIMEOUT_MS / 1000}s without answering get_commands${detail}`]);
  }
  const problems = stderr.split("\n").filter((line) => /^Error:|Failed to load/.test(line));
  const registered = new Map(commands.map((command) => [command.name, command.sourceInfo?.path]));
  for (const [name, canonicalPath] of await canonicalCommands()) {
    const path = registered.get(name);
    if (path === undefined) {
      problems.push(`${name} is not registered`);
    } else if ((await realpath(path).catch(() => null)) !== (await realpath(canonicalPath))) {
      problems.push(`${name} is registered from ${path}, not ${canonicalPath}`);
    }
  }
  if (problems.length > 0) return failed(problems);
  console.log(`Pi harness load check passed: ${commands.length} commands registered, no load errors.`);
  return 0;
}

process.exit(await main());
