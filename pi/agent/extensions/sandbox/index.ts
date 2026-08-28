import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { getAgentDir, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import {
  deniedBashCommandReason,
  hasPluginWorkspaceAccess,
  hasTrustedSharedReadAccess,
  isControlPlaneWriteBlocked,
  isProtectedSecretPath,
  isWithin,
  shellPathCandidates,
} from "./policy.ts";
import { hardenPiPermissions } from "./permissions.ts";

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const CODING_HARNESS_ROOT = resolve(dirname(realpathSync.native(__filename)), "../../../..");
const CODING_HARNESS_SHARED_ROOT = join(CODING_HARNESS_ROOT, "shared");
const configuredPluginsRoot = resolve(homedir(), "pi-plugins");
const PI_PLUGINS_ROOT = existsSync(configuredPluginsRoot) ? realpathSync.native(configuredPluginsRoot) : configuredPluginsRoot;
const TEMP_ROOT = realpathSync.native(tmpdir());
const CURRENT_UID = typeof process.getuid === "function" ? process.getuid() : undefined;
const TEMP_PARENT = CURRENT_UID === undefined ? undefined : join(TEMP_ROOT, `pi-agent-${CURRENT_UID}`);
const PI_PACKAGES_ROOT = resolve(
  process.env.VOLTA_HOME ?? join(process.env.HOME ?? "~", ".volta"),
  "tools/image/packages",
);
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

function ensurePrivateDirectory(path: string, uid: number): void {
  mkdirSync(path, { mode: 0o700, recursive: true });
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${path} is not a private directory`);
  if (stats.uid !== uid) throw new Error(`${path} is owned by another user`);
  if ((stats.mode & 0o077) !== 0) chmodSync(path, 0o700);
}

function isSessionId(value: string): boolean {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function createSessionTempDirectory(sessionId: string): string {
  if (CURRENT_UID === undefined || TEMP_PARENT === undefined) {
    throw new Error("session temp directories require POSIX ownership checks");
  }
  if (!isSessionId(sessionId)) throw new Error("invalid Pi session ID");
  ensurePrivateDirectory(TEMP_PARENT, CURRENT_UID);
  const sessionTempDirectory = join(TEMP_PARENT, sessionId);
  ensurePrivateDirectory(sessionTempDirectory, CURRENT_UID);
  return realpathSync.native(sessionTempDirectory);
}

function isTrustedRetainedSessionRead(path: string): boolean {
  if (CURRENT_UID === undefined || TEMP_PARENT === undefined || !isWithin(TEMP_PARENT, path)) return false;
  const [sessionId, artifact, ...descendants] = relative(TEMP_PARENT, path).split(sep);
  if (!isSessionId(sessionId) || !artifact) return false;

  try {
    const sessionDirectory = join(TEMP_PARENT, sessionId);
    const stats = lstatSync(sessionDirectory);
    if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== CURRENT_UID || (stats.mode & 0o077) !== 0) {
      return false;
    }
  } catch {
    return false;
  }

  if (/^agent-final-[0-9a-f]{12}\.html$/.test(artifact)) return descendants.length === 0;
  if (/^agent-final-[0-9a-f]{12}-captures$/.test(artifact)) return true;
  if (/^handoff-\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+){1,2}\.md$/.test(artifact)) {
    return descendants.length === 0;
  }
  return artifact === "repo-session-retrospective.html" && descendants.length === 0;
}

function isTrustedOutsideRead(toolName: string, path: string): boolean {
  return isWithin(PI_PACKAGES_ROOT, path)
    || hasTrustedSharedReadAccess(toolName, path, CODING_HARNESS_SHARED_ROOT);
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
  if (isProtectedSecretPath(resolved)) return { resolved, reason: "protected secret path" };
  if (!isWithin(root, resolved)) {
    return { resolved, outside: true, reason: `path resolves outside the session directory (${resolved})` };
  }
  return { resolved };
}

function changesDirectoryToSessionTemp(command: string, sessionTempDirectory: string): boolean {
  return command.split(/&&|\|\||[;|]/).some((segment) => {
    const tokens = segment
      .replace(/'([^']*)'/g, "$1")
      .replace(/"((?:\\.|[^"\\])*)"/g, "$1")
      .trim()
      .split(/\s+/)
      .map((token) => token.replace(/^[({]+|[)}]+$/g, ""));
    const commandIndex = tokens.findIndex((token) => {
      const isPrefix = /^(?:if|then|elif|else|do|command|builtin|time|!)$/.test(token)
        || /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
      return token !== "" && !isPrefix;
    });
    if (commandIndex === -1 || (tokens[commandIndex] !== "cd" && tokens[commandIndex] !== "pushd")) return false;
    if (segment.includes("PI_SESSION_TMPDIR")) return true;
    const target = tokens.slice(commandIndex + 1).find((token) => !token.startsWith("-"));
    if (!target) return false;
    const expanded = target.startsWith("~") ? join(process.env.HOME ?? "~", target.slice(1)) : target;
    return isAbsolute(expanded) && isWithin(sessionTempDirectory, realpathForCheck(expanded));
  });
}

function block(reason: string) {
  return { block: true, reason: `Sandbox blocked tool call: ${reason}` };
}

export function createSandboxGuard(cwd = process.cwd(), getSessionTempDirectory: () => string | undefined = () => undefined) {
  const root = realpathSync.native(cwd);
  const sessionReadApprovals = new Set<string>();
  const isPluginWorkspacePath = (path: string) => hasPluginWorkspaceAccess(root, path, CODING_HARNESS_ROOT, PI_PLUGINS_ROOT);
  const isSessionTempPath = (path: string) => {
    const sessionTempDirectory = getSessionTempDirectory();
    return sessionTempDirectory !== undefined && isWithin(sessionTempDirectory, path);
  };

  return async (event: ToolCallEvent, ctx: { hasUI: boolean; ui: { select: (title: string, options: string[]) => Promise<string | undefined> } }) => {
    if (FILE_TOOLS.has(event.toolName)) {
      const input = event.input as { path?: unknown };
      if (typeof input.path === "string") {
        const inspection = inspectPath(root, input.path);
        const isWrite = !READ_TOOLS.has(event.toolName);
        if (isWrite && inspection.resolved
          && isControlPlaneWriteBlocked(root, inspection.resolved, CODING_HARNESS_ROOT, PI_PLUGINS_ROOT)) {
          return block(`${input.path}: agent control-plane writes require a coding-harness session`);
        }
        if (inspection.reason && !inspection.outside) return block(`${input.path}: ${inspection.reason}`);
        if (inspection.outside) {
          if (!inspection.resolved) return block(`${input.path}: ${inspection.reason}`);
          if (isSessionTempPath(inspection.resolved) || isPluginWorkspacePath(inspection.resolved)) return undefined;
          if (!READ_TOOLS.has(event.toolName)) return block(`${input.path}: ${inspection.reason}`);
          if (isTrustedRetainedSessionRead(inspection.resolved)
            || isTrustedOutsideRead(event.toolName, inspection.resolved)) return undefined;
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
        const permittedOutsidePath = inspection.outside && inspection.resolved
          && (isSessionTempPath(inspection.resolved) || isPluginWorkspacePath(inspection.resolved));
        if (inspection.reason && !permittedOutsidePath) return block(`${requestedCwd}: ${inspection.reason}`);
      }
    }

    if (isToolCallEventType("bash", event)) {
      const sessionTempDirectory = getSessionTempDirectory();
      const denyReason = deniedBashCommandReason(event.input.command, root, undefined, sessionTempDirectory);
      if (denyReason) return block(denyReason);

      if (sessionTempDirectory && changesDirectoryToSessionTemp(event.input.command, sessionTempDirectory)) {
        return block("Bash cannot change its working directory to the session temp directory; use absolute paths instead");
      }
      for (const candidate of shellPathCandidates(event.input.command)) {
        const path = candidate.startsWith("~") ? join(process.env.HOME ?? "~", candidate.slice(1)) : candidate;
        const inspection = inspectPath(root, path);
        if (inspection.resolved
          && isControlPlaneWriteBlocked(root, inspection.resolved, CODING_HARNESS_ROOT, PI_PLUGINS_ROOT)) {
          return block(`${candidate}: Bash access to the agent control plane requires a coding-harness session`);
        }
        const permittedOutsidePath = inspection.outside && inspection.resolved
          && (isSessionTempPath(inspection.resolved) || isPluginWorkspacePath(inspection.resolved));
        if (inspection.reason && !permittedOutsidePath) return block(`${candidate}: ${inspection.reason}`);
      }
    }

    return undefined;
  };
}

export default function sandboxExtension(pi: ExtensionAPI) {
  let sessionTempDirectory: string | undefined;
  const guard = createSandboxGuard(process.cwd(), () => sessionTempDirectory);

  pi.on("session_start", (_event, ctx) => {
    try {
      hardenPiPermissions(getAgentDir());
    } catch (error) {
      ctx.ui.notify(`Could not harden Pi file permissions: ${error instanceof Error ? error.message : String(error)}`, "error");
    }

    try {
      sessionTempDirectory = createSessionTempDirectory(ctx.sessionManager.getSessionId());
      process.env.PI_SESSION_TMPDIR = sessionTempDirectory;
    } catch (error) {
      sessionTempDirectory = undefined;
      delete process.env.PI_SESSION_TMPDIR;
      ctx.ui.notify(`Could not create the session temp directory: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  });

  pi.on("before_agent_start", (event) => {
    if (!sessionTempDirectory) return undefined;
    return {
      systemPrompt: `${event.systemPrompt}\n\nSession temporary workspace: ${sessionTempDirectory}\nUse this directory for disposable clones, generated analysis, and other scratch artifacts instead of placing them in the repository root. It is also available to Bash commands as $PI_SESSION_TMPDIR; use absolute paths rather than changing Bash's working directory to it.`,
    };
  });

  pi.on("session_shutdown", () => {
    if (process.env.PI_SESSION_TMPDIR === sessionTempDirectory) delete process.env.PI_SESSION_TMPDIR;
    sessionTempDirectory = undefined;
  });

  pi.on("tool_call", (event, ctx) => guard(event, ctx));
}
