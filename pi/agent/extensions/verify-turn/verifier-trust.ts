import { accessSync, constants as fsConstants, existsSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";

type TrustSnapshot = {
  displayPath: string;
  signature: string;
  safe: boolean;
};

type Confirm = (title: string, message: string) => Promise<boolean>;

function isWithin(root: string, path: string): boolean {
  const distance = relative(root, path);
  return distance === "" || (distance !== ".." && !distance.startsWith(`..${sep}`) && !isAbsolute(distance));
}

function trustTarget(cwd: string): string | undefined {
  const script = join(cwd, ".agent", "verify.sh");
  try {
    accessSync(script, fsConstants.X_OK);
    return script;
  } catch {
    // Fall through to Taskfile discovery.
  }

  for (const filename of ["Taskfile.yml", "Taskfile.yaml"]) {
    const taskfile = join(cwd, filename);
    if (existsSync(taskfile)) return taskfile;
  }
  return undefined;
}

function snapshot(cwd: string): TrustSnapshot | undefined {
  const target = trustTarget(cwd);
  if (!target) return undefined;

  let resolved: string;
  let content: Buffer;
  try {
    resolved = realpathSync.native(target);
    content = readFileSync(resolved);
  } catch {
    return { displayPath: target, signature: `unreadable:${target}`, safe: false };
  }

  return {
    displayPath: resolved,
    signature: `${resolved}:${createHash("sha256").update(content).digest("hex")}`,
    safe: isWithin(realpathSync.native(cwd), resolved),
  };
}

export class VerifierTrustGate {
  private readonly decisions = new Map<string, boolean>();

  async requestApproval(cwd: string, hasUI: boolean, confirm: Confirm): Promise<boolean> {
    const current = snapshot(cwd);
    if (!current) return true;
    if (!current.safe) return false;

    const previous = this.decisions.get(current.signature);
    if (previous !== undefined) return previous;
    if (!hasUI) {
      this.decisions.set(current.signature, false);
      return false;
    }

    const approved = await confirm(
      "Trust repository verifier for this session?",
      `${current.displayPath}\n\nThis repository-controlled file may execute commands with your user permissions after agent turns.`,
    );
    this.decisions.set(current.signature, approved);
    return approved;
  }

  isApproved(cwd: string): boolean {
    const current = snapshot(cwd);
    return current === undefined || (current.safe && this.decisions.get(current.signature) === true);
  }
}
