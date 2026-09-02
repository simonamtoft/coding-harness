import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_OUTPUT_BYTES = 50_000;
const MAX_OUTPUT_LINES = 2_000;

export type Diagnostics = {
  label: ".agent/diagnostics.sh";
  command: string;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
};

export async function resolveDiagnostics(cwd: string): Promise<Diagnostics | undefined> {
  const command = join(cwd, ".agent", "diagnostics.sh");
  try {
    await access(command, fsConstants.X_OK);
    return { label: ".agent/diagnostics.sh", command };
  } catch {
    return undefined;
  }
}

function terminateProcessTree(pid: number): void {
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The diagnostic process has already exited.
    }
  }
}

async function executeScript(
  command: string,
  path: string,
  cwd: string,
  signal: AbortSignal | undefined,
  timeout: number,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ stdout: "", stderr: "diagnostics cancelled", code: 1, killed: true });
      return;
    }

    const child = spawn(command, [path], {
      cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let settled = false;
    const timeoutHandle = setTimeout(() => {
      if (child.pid !== undefined) terminateProcessTree(child.pid);
    }, timeout);
    const onAbort = () => {
      if (child.pid !== undefined) terminateProcessTree(child.pid);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, code: exitCode ?? 1, killed: exitCode === null });
    };

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      stderr += `${stderr ? "\n" : ""}${error.message}`;
      exitCode = 1;
      finish();
    });
    child.once("exit", (code) => {
      exitCode = code;
      if (child.pid !== undefined) terminateProcessTree(child.pid);
    });
    child.once("close", finish);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runDiagnostics(
  content: Buffer,
  path: string,
  cwd: string,
  signal: AbortSignal | undefined,
  timeout: number,
): Promise<ExecResult> {
  const directory = await mkdtemp(join(tmpdir(), "pi-diagnostics-"));
  const command = join(directory, "diagnostics.sh");
  try {
    await writeFile(command, content, { mode: 0o700 });
    await chmod(command, 0o700);
    return await executeScript(command, path, cwd, signal, timeout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function formatDiagnosticResult(result: ExecResult): string {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)";
  const lines = output.split("\n");
  const lineLimited = lines.slice(-MAX_OUTPUT_LINES).join("\n");
  const byteLimited = Buffer.from(lineLimited).subarray(-MAX_OUTPUT_BYTES).toString();
  const truncated = lines.length > MAX_OUTPUT_LINES || Buffer.byteLength(lineLimited) > MAX_OUTPUT_BYTES;
  const suffix = truncated ? "\n\n[Diagnostic output truncated.]" : "";
  const status = result.code === 0 ? "passed" : "reported findings";

  return `Fast diagnostics (${status}; advisory only):\n${byteLimited}${suffix}`;
}
