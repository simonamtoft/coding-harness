import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const CODING_HARNESS_ROOT = resolve(dirname(realpathSync.native(__filename)), "../../../..");
const PI_PACKAGES_ROOT = resolve(
  process.env.VOLTA_HOME ?? join(process.env.HOME ?? "~", ".volta"),
  "tools/image/packages",
);
const SECRET_PATTERNS = [
  /(^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|\.aws(?:\/|$)|\.gnupg(?:\/|$)|\.azure(?:\/|$)|\.kube(?:\/|$)|\.gcloud(?:\/|$))/,
  /(^|\/)(?:credentials\.json|service-account[^/]*\.json|id_rsa|id_ed25519|\.netrc|\.npmrc|\.pypirc)$/,
  /(^|\/)\.config\/gcloud(?:\/|$)/,
  /(^|\/)Library\/Keychains(?:\/|$)/,
  /(^|\/)\.docker\/config\.json$/,
  /\.(?:pem|key)$/,
];

function realpathForCheck(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  let candidate = absolute;
  const suffix: string[] = [];

  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return normalize(absolute);
    suffix.unshift(candidate.slice(parent.length + 1));
    candidate = parent;
  }

  return join(realpathSync.native(candidate), ...suffix);
}

function isWithin(root: string, path: string): boolean {
  const distance = relative(root, path);
  return distance === "" || (distance !== ".." && !distance.startsWith(`..${sep}`) && !isAbsolute(distance));
}

function isSecret(path: string): boolean {
  const normalized = normalize(path);
  return SECRET_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isTrustedOutsideRead(path: string): boolean {
  return isWithin(PI_PACKAGES_ROOT, path)
    || (basename(path) === "SKILL.md" && isWithin(CODING_HARNESS_ROOT, path));
}

function inspectPath(root: string, rawPath: string): { resolved?: string; reason?: string; outside?: boolean } {
  if (!rawPath.trim()) return { reason: "path is empty" };

  let normalizedInput = rawPath.trim();
  if (normalizedInput.startsWith("@")) normalizedInput = normalizedInput.slice(1);
  if (normalizedInput.startsWith("file://")) {
    try {
      normalizedInput = fileURLToPath(normalizedInput);
    } catch {
      return { reason: "invalid file URL" };
    }
  }
  if (normalizedInput === "~" || normalizedInput.startsWith("~/")) {
    normalizedInput = join(process.env.HOME ?? "~", normalizedInput.slice(1));
  }

  const resolved = realpathForCheck(normalizedInput);
  if (isSecret(resolved)) return { resolved, reason: "protected secret path" };
  if (!isWithin(root, resolved)) {
    return { resolved, outside: true, reason: `path resolves outside the session directory (${resolved})` };
  }
  return { resolved };
}

function shellPathCandidates(command: string): string[] {
  // This is intentionally conservative. It catches explicit paths while
  // leaving shell syntax and ordinary command arguments alone.
  const segments = command.split(/&&|\|\||[;|]/);
  const looksLikePath = (token: string) => {
    const unprefixed = token.startsWith("@") ? token.slice(1) : token;
    return unprefixed === ".." || unprefixed.startsWith("../") || unprefixed.startsWith("./") || unprefixed.startsWith("/") || unprefixed === "~" || unprefixed.startsWith("~/");
  };
  const isSystemCommand = (token: string) => /^\/(?:bin|sbin|usr\/(?:bin|sbin|local\/bin)|opt\/homebrew\/(?:bin|sbin))\//.test(token);

  return segments.flatMap((segment) => {
    const tokens = segment
      .replace(/'[^']*'/g, (value) => value.slice(1, -1))
      .replace(/"(?:\\.|[^"\\])*"/g, (value) => value.slice(1, -1))
      .split(/\s+/)
      .map((token) => token.replace(/^[([{;,]+|[)\]},;&]+$/g, ""));
    return tokens.filter((token, index) => {
      if (!token) return false;
      if (index === 0 && isSystemCommand(token)) return false;
      return looksLikePath(token) || isSecret(token);
    });
  });
}

function block(reason: string) {
  return { block: true, reason: `Sandbox blocked tool call: ${reason}` };
}

export function createSandboxGuard(cwd = process.cwd()) {
  const root = realpathSync.native(cwd);
  const sessionReadApprovals = new Set<string>();

  return async (event: ToolCallEvent, ctx: { hasUI: boolean; ui: { select: (title: string, options: string[]) => Promise<string | undefined> } }) => {
    if (FILE_TOOLS.has(event.toolName)) {
      const input = event.input as { path?: unknown };
      if (typeof input.path === "string") {
        const inspection = inspectPath(root, input.path);
        if (inspection.reason && !inspection.outside) return block(`${input.path}: ${inspection.reason}`);
        if (inspection.outside) {
          if (!READ_TOOLS.has(event.toolName) || !inspection.resolved) {
            return block(`${input.path}: ${inspection.reason}`);
          }
          if (isTrustedOutsideRead(inspection.resolved)) return undefined;
          if (sessionReadApprovals.has(inspection.resolved)) return undefined;
          if (!ctx.hasUI) return block(`${input.path}: outside reads require interactive approval`);

          const choice = await ctx.ui.select(
            `Read outside the session directory?\n${inspection.resolved}`,
            ["Allow once", "Allow for this session", "Deny"],
          );
          if (choice === "Allow once") return undefined;
          if (choice === "Allow for this session") {
            sessionReadApprovals.add(inspection.resolved);
            return undefined;
          }
          return block(`${input.path}: outside read denied by user`);
        }
      }
    }

    if (event.toolName === "subagent") {
      const input = event.input as {
        cwd?: unknown;
        tasks?: Array<{ cwd?: unknown }>;
        chain?: Array<{ cwd?: unknown }>;
      };
      const requestedCwds = [
        input.cwd,
        ...(input.tasks ?? []).map((task) => task.cwd),
        ...(input.chain ?? []).map((step) => step.cwd),
      ];
      for (const requestedCwd of requestedCwds) {
        if (typeof requestedCwd !== "string") continue;
        const inspection = inspectPath(root, requestedCwd);
        if (inspection.reason) return block(`${requestedCwd}: ${inspection.reason}`);
      }
    }

    if (isToolCallEventType("bash", event)) {
      for (const candidate of shellPathCandidates(event.input.command)) {
        const path = candidate.startsWith("~") ? join(process.env.HOME ?? "~", candidate.slice(1)) : candidate;
        const inspection = inspectPath(root, path);
        if (inspection.reason) return block(`${candidate}: ${inspection.reason}`);
      }
    }

    return undefined;
  };
}

export default function sandboxExtension(pi: ExtensionAPI) {
  const guard = createSandboxGuard();
  pi.on("tool_call", (event, ctx) => guard(event, ctx));
}
