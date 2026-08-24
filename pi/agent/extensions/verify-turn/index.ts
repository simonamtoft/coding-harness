import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  DynamicBorder,
  formatSize,
  keyHint,
  truncateTail,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  CancellableLoader,
  Container,
  Spacer,
  stripTerminalSequences,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

const MAX_ROUNDS = 3;

type Verifier =
  | { label: ".agent/verify.sh"; command: string; args: string[] }
  | { label: "task verify"; command: "task"; args: string[] };

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveVerifier(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal,
): Promise<Verifier | undefined> {
  const verifyScript = join(cwd, ".agent", "verify.sh");
  if (await isExecutable(verifyScript)) {
    return { label: ".agent/verify.sh", command: verifyScript, args: [] };
  }

  for (const filename of ["Taskfile.yml", "Taskfile.yaml"]) {
    const taskfile = join(cwd, filename);
    try {
      await access(taskfile);
    } catch {
      continue;
    }

    signal.throwIfAborted();
    const listed = await pi.exec("task", ["--taskfile", taskfile, "--list-all"], {
      cwd,
      signal,
      timeout: 10_000,
    });
    if (listed.code === 0 && /^\* verify:/m.test(listed.stdout)) {
      return { label: "task verify", command: "task", args: ["--taskfile", taskfile, "verify"] };
    }
  }

  return undefined;
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
      // The verifier and its process group have already exited.
    }
  }
}

function executeVerifier(
  verifier: Verifier,
  cwd: string,
  signal: AbortSignal,
  onOutput?: (chunk: string) => void,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ stdout: "", stderr: "", code: 1 });
      return;
    }

    const child = (() => {
      try {
        return spawn(verifier.command, verifier.args, {
          cwd,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        resolve({
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          code: 1,
        });
        return undefined;
      }
    })();
    if (!child) return;

    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let settled = false;

    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ stdout, stderr, code: exitCode ?? 1 });
    };
    const onAbort = () => {
      if (child.pid !== undefined) terminateProcessTree(child.pid);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onOutput?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onOutput?.(text);
    });
    child.once("error", (error) => {
      stderr += `${stderr ? "\n" : ""}${error.message}`;
      exitCode = 1;
      finish();
    });
    child.once("exit", (code) => {
      exitCode = code;
      // Verifiers may leave web servers or browser workers behind after their
      // direct process exits. They must not outlive the verification run.
      if (child.pid !== undefined) terminateProcessTree(child.pid);
    });
    child.once("close", finish);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

class VerificationLoader extends Container {
  private readonly tui: TUI;
  private readonly loader: CancellableLoader;
  private readonly output: Text;
  private readonly startedAt = Date.now();
  private readonly timer: NodeJS.Timeout;
  private readonly verifierLabel: string;
  private recentOutput = "";

  constructor(tui: TUI, theme: Theme, verifierLabel: string) {
    super();
    this.tui = tui;
    this.verifierLabel = verifierLabel;
    const borderColor = (text: string) => theme.fg("border", text);
    this.loader = new CancellableLoader(
      tui,
      (text) => theme.fg("accent", text),
      (text) => theme.fg("muted", text),
      `Project checks · ${verifierLabel} · 0s elapsed`,
    );
    this.output = new Text(theme.fg("dim", "Waiting for output…"), 1, 0);

    this.addChild(new DynamicBorder(borderColor));
    this.addChild(this.loader);
    this.addChild(new Spacer(1));
    this.addChild(this.output);
    this.addChild(new Spacer(1));
    this.addChild(new Text(keyHint("tui.select.cancel", "cancel project checks"), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder(borderColor));

    this.timer = setInterval(() => {
      this.updateHeading();
      tui.requestRender();
    }, 1_000);
  }

  appendOutput(chunk: string): void {
    const safeChunk = stripTerminalSequences(chunk)
      .replace(/\r(?!\n)/g, "\n")
      .replace(/[^\t\n\x20-\x7E\u00A0-\u{10FFFF}]/gu, "");
    this.recentOutput = (this.recentOutput + safeChunk).slice(-20_000);
    const lines = this.recentOutput.split("\n");
    const visibleLines = lines.slice(-12).join("\n").trim();
    this.output.setText(visibleLines || "Waiting for output…");
    this.tui.requestRender();
  }

  set onAbort(handler: (() => void) | undefined) {
    this.loader.onAbort = handler;
  }

  handleInput(data: string): void {
    this.loader.handleInput(data);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.loader.dispose();
  }

  private updateHeading(): void {
    const elapsedSeconds = Math.floor((Date.now() - this.startedAt) / 1_000);
    this.loader.setMessage(`Project checks · ${this.verifierLabel} · ${elapsedSeconds}s elapsed`);
  }
}

function formatFailure(output: string): string {
  const truncated = truncateTail(output.trim() || "(verifier exited non-zero without output)", {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  if (!truncated.truncated) return truncated.content;

  return [
    truncated.content,
    "",
    `[Verifier output truncated: showing ${truncated.outputLines} of ${truncated.totalLines} lines ` +
      `(${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)}).]`,
  ].join("\n");
}

export default function verifyTurn(pi: ExtensionAPI) {
  let rounds = 0;
  let verificationRunning = false;
  let shouldVerifySettledRun = false;
  let sessionActive = false;
  let guidanceController: AbortController | undefined;
  let verificationController: AbortController | undefined;

  pi.on("session_start", (_event, ctx) => {
    rounds = 0;
    verificationRunning = false;
    shouldVerifySettledRun = false;
    sessionActive = true;
    guidanceController = undefined;
    verificationController = undefined;
    ctx.ui.setStatus("verify-turn", undefined);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    sessionActive = false;
    guidanceController?.abort();
    verificationController?.abort();
    ctx.ui.setStatus("verify-turn", undefined);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    guidanceController?.abort();
    const controller = new AbortController();
    guidanceController = controller;
    let verifier: Verifier | undefined;
    try {
      verifier = await resolveVerifier(pi, ctx.cwd, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      return;
    }
    if (!sessionActive || controller.signal.aborted || !verifier) return;

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\nAn automatic end-of-turn project verifier (${verifier.label}) is active. ` +
        "Do not run that full verifier yourself as a final check; it runs after you settle and feeds failures back for repair. " +
        "During implementation, run only narrower checks that provide useful immediate feedback.",
    };
  });

  pi.on("agent_end", (event) => {
    const finalAssistant = [...event.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    shouldVerifySettledRun = finalAssistant !== undefined && finalAssistant.stopReason !== "aborted";
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!shouldVerifySettledRun || verificationRunning || process.env.PI_VERIFY_DISABLE === "1") return;
    shouldVerifySettledRun = false;

    const cwd = ctx.cwd;
    const controller = new AbortController();
    verificationRunning = true;
    verificationController = controller;
    ctx.ui.setStatus("verify-turn", "discovering project checks…");

    let verifier: Verifier | undefined;
    try {
      verifier = await resolveVerifier(pi, cwd, controller.signal);
    } catch (error) {
      if (verificationController === controller) {
        verificationRunning = false;
        verificationController = undefined;
        ctx.ui.setStatus("verify-turn", undefined);
      }
      if (!controller.signal.aborted) throw error;
      return;
    }
    if (!sessionActive || controller.signal.aborted) return;
    if (!verifier) {
      rounds = 0;
      verificationRunning = false;
      verificationController = undefined;
      ctx.ui.setStatus("verify-turn", undefined);
      return;
    }
    ctx.ui.setStatus("verify-turn", "running project checks…");

    const runVerification = async (loader?: VerificationLoader) => {
      const result = await executeVerifier(verifier, cwd, controller.signal, (chunk) => {
        loader?.appendOutput(chunk);
      });
      if (!sessionActive || controller.signal.aborted) return;
      if (result.code === 0) {
        rounds = 0;
        return;
      }

      rounds += 1;
      const output = formatFailure([result.stdout, result.stderr].filter(Boolean).join("\n"));

      if (rounds > MAX_ROUNDS) {
        rounds = 0;
        const message = `Verification is still failing after ${MAX_ROUNDS} repair attempts (${verifier.label}); leaving it for the user to resolve:\n\n${output}`;
        pi.sendMessage({ customType: "verify-turn", content: message, display: true });
        if (ctx.hasUI) ctx.ui.notify("Verification is still failing; see the reported output.", "warning");
        return;
      }

      const finalAttempt = rounds === MAX_ROUNDS;
      const reportingReminder =
        "In your next response, carry forward the complete original-task summary and prior verification; add this repair rather than reporting only the latest failure or fix.";
      const instruction = finalAttempt
        ? `Verification failed (${verifier.label}) — attempt ${rounds}/${MAX_ROUNDS} (final). Fix the failure if possible. If the next verification still fails, stop and summarize the remaining problem for the user. ${reportingReminder}`
        : `Verification failed (${verifier.label}) — attempt ${rounds}/${MAX_ROUNDS}. Fix it before finishing. ${reportingReminder}`;

      pi.sendMessage(
        {
          customType: "verify-turn",
          content: `${instruction}\n\n${output}`,
          display: true,
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    };

    try {
      if (ctx.mode === "tui") {
        const error = await ctx.ui.custom<unknown | undefined>((tui, theme, _keybindings, done) => {
          const loader = new VerificationLoader(tui, theme, verifier.label);
          let finished = false;
          const finish = (result: unknown | undefined) => {
            if (finished) return;
            finished = true;
            done(result);
          };
          loader.onAbort = () => {
            controller.abort();
          };
          void runVerification(loader).then(
            () => finish(undefined),
            (error) => finish(error),
          );
          return loader;
        });
        if (error !== undefined) throw error;
      } else {
        await runVerification();
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (sessionActive && verificationController === controller) {
        ctx.ui.setStatus("verify-turn", undefined);
        verificationController = undefined;
        verificationRunning = false;
      }
    }
  });
}
