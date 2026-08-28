import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type Verifier =
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

export async function resolveVerifier(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal,
  projectTrusted: boolean,
): Promise<Verifier | undefined> {
  if (!projectTrusted) return undefined;

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
