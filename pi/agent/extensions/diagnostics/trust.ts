import { accessSync, constants as fsConstants, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";

type TrustSnapshot = {
  displayPath: string;
  signature: string;
  safe: boolean;
  content?: Buffer;
};

type Confirm = (title: string, message: string) => Promise<boolean>;

function isWithin(root: string, path: string): boolean {
  const distance = relative(root, path);
  return distance === "" || (distance !== ".." && !distance.startsWith(`..${sep}`) && !isAbsolute(distance));
}

function snapshot(cwd: string): TrustSnapshot | undefined {
  const target = join(cwd, ".agent", "diagnostics.sh");
  try {
    accessSync(target, fsConstants.X_OK);
  } catch {
    return undefined;
  }

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
    content,
  };
}

export class DiagnosticsTrustGate {
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
      "Trust repository fast diagnostics for this session?",
      `${current.displayPath}\n\nThis repository-controlled file may execute commands with your user permissions after successful edits. Its results are advisory only.`,
    );
    this.decisions.set(current.signature, approved);
    return approved;
  }

  approvedContent(cwd: string): Buffer | undefined {
    const current = snapshot(cwd);
    if (!current?.safe || !current.content || this.decisions.get(current.signature) !== true) return undefined;
    return current.content;
  }

  isApproved(cwd: string): boolean {
    return this.approvedContent(cwd) !== undefined;
  }
}
