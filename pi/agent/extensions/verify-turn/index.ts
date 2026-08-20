import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateTail,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const MAX_ROUNDS = 3;

type Verifier =
  | { label: ".pi/verify.sh"; command: string; args: string[] }
  | { label: "task verify"; command: "task"; args: string[] };

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveVerifier(pi: ExtensionAPI, cwd: string): Promise<Verifier | undefined> {
  const verifyScript = join(cwd, ".pi", "verify.sh");
  if (await isExecutable(verifyScript)) {
    return { label: ".pi/verify.sh", command: verifyScript, args: [] };
  }

  for (const filename of ["Taskfile.yml", "Taskfile.yaml"]) {
    const taskfile = join(cwd, filename);
    try {
      await access(taskfile);
    } catch {
      continue;
    }

    const listed = await pi.exec("task", ["--taskfile", taskfile, "--list-all"], {
      cwd,
      timeout: 10_000,
    });
    if (listed.code === 0 && /^\* verify:/m.test(listed.stdout)) {
      return { label: "task verify", command: "task", args: ["--taskfile", taskfile, "verify"] };
    }
  }

  return undefined;
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

  pi.on("session_start", () => {
    rounds = 0;
    verificationRunning = false;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (verificationRunning || process.env.PI_VERIFY_DISABLE === "1") return;

    verificationRunning = true;
    ctx.ui.setStatus("verify-turn", "verifying…");

    try {
      const verifier = await resolveVerifier(pi, ctx.cwd);
      if (!verifier) {
        rounds = 0;
        return;
      }

      const result = await pi.exec(verifier.command, verifier.args, { cwd: ctx.cwd });
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
      const instruction = finalAttempt
        ? `Verification failed (${verifier.label}) — attempt ${rounds}/${MAX_ROUNDS} (final). Fix the failure if possible. If the next verification still fails, stop and summarize the remaining problem for the user.`
        : `Verification failed (${verifier.label}) — attempt ${rounds}/${MAX_ROUNDS}. Fix it before finishing.`;

      pi.sendMessage(
        {
          customType: "verify-turn",
          content: `${instruction}\n\n${output}`,
          display: true,
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    } finally {
      ctx.ui.setStatus("verify-turn", undefined);
      verificationRunning = false;
    }
  });
}
