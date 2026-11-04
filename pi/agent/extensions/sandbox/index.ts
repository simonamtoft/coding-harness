import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { BashSpawnContext, ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  createLocalBashOperations,
  getAgentDir,
  isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import {
  deniedBashCommandReason,
  hasPluginWorkspaceAccess,
  hasSafeResearchVaultBashPaths,
  hasTrustedSharedReadAccess,
  hasResearchVaultReadAccess,
  hasSessionHistoryReadAccess,
  permitsSessionHistoryCommand,
  isControlPlaneWriteBlocked,
  isProtectedSecretTarget,
  isTrustedSharedSkillHelper,
  permitsRootVerifierScriptBashReference,
  isReadOnlyInspectionCommand,
  isWithin,
  namesMissingRootEntry,
  playwrightBrowsersRoot,
  requestResearchVaultConfirmation,
  researchVaultBashOperation,
  sameRepositoryWorktrees,
  shellPathCandidates,
} from "./policy.ts";
import { hardenPiPermissions } from "./permissions.ts";
import {
  azureCredentialProgram,
  confirmedCommand,
  requestAzureCredentials,
  requestCommandConfirmation,
} from "./confirmed-commands.ts";
import { registerRecentSessionsTool } from "./recent-sessions-tool.ts";
import {
  commandSandboxMode,
  commandSandboxProfile,
  commandSandboxScope,
  confinedEnvironment,
  confinedShellCommand,
  DISABLE_VARIABLE,
} from "./kernel-sandbox.ts";
import { currentRepositoryRoot, isRepositorySessionTranscript, isSafeSessionHistoryTree, isSessionHistoryDirectory, sessionHistoryRoot } from "./session-history.ts";

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
const PLAYWRIGHT_BROWSERS_ROOT = playwrightBrowsersRoot();
const configuredAzureConfigRoot = resolve(homedir(), ".azure");
const AZURE_CONFIG_ROOT = existsSync(configuredAzureConfigRoot)
  ? realpathSync.native(configuredAzureConfigRoot)
  : configuredAzureConfigRoot;
const configuredResearchVaultRoot = resolve(homedir(), "research");
const RESEARCH_VAULT_ROOT = existsSync(configuredResearchVaultRoot)
  ? realpathSync.native(configuredResearchVaultRoot)
  : configuredResearchVaultRoot;
function realpathForCheck(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  let candidate = absolute;
  const suffix: string[] = [];

  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return normalize(absolute);
    suffix.unshift(basename(candidate));
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
    || isWithin(PLAYWRIGHT_BROWSERS_ROOT, path)
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
  if (isProtectedSecretTarget(resolved, root)) return { resolved, reason: "protected secret path" };
  if (!isWithin(root, resolved)) {
    return { resolved, outside: true, reason: `path resolves outside the session directory (${resolved})` };
  }
  return { resolved };
}

function block(reason: string) {
  return { block: true, reason: `Sandbox blocked tool call: ${reason}` };
}

export function createSandboxGuard(
  cwd = process.cwd(),
  getSessionTempDirectory: () => string | undefined = () => undefined,
  researchVaultRoot = RESEARCH_VAULT_ROOT,
  grantCommandRoots: (command: string, roots: string[]) => void = () => {},
) {
  let azureApprovedForSession = false;
  const root = realpathSync.native(cwd);
  const repositoryRoot = currentRepositoryRoot(root);
  const resolvedResearchVaultRoot = realpathForCheck(researchVaultRoot);
  const configuredHistoryRoot = sessionHistoryRoot();
  const historyRoot = realpathForCheck(configuredHistoryRoot);
  const historyHelper = join(CODING_HARNESS_ROOT, "pi/agent/extensions/sandbox/session-history.ts");
  const installedHistoryHelper = join(homedir(), ".pi/agent/extensions/sandbox/session-history.ts");
  const canReadSessionHistory = (toolName: string, path: string) =>
    hasSessionHistoryReadAccess(toolName, root, path, CODING_HARNESS_ROOT, historyRoot)
    && isSessionHistoryDirectory(configuredHistoryRoot)
    && realpathForCheck(configuredHistoryRoot) === historyRoot;
  const sessionReadApprovals = new Set<string>();
  const isPluginWorkspacePath = (path: string) => hasPluginWorkspaceAccess(root, path, CODING_HARNESS_ROOT, PI_PLUGINS_ROOT);
  const isSessionTempPath = (path: string) => {
    const sessionTempDirectory = getSessionTempDirectory();
    return sessionTempDirectory !== undefined && isWithin(sessionTempDirectory, path);
  };
  // Listed per check, not cached, so worktrees added during the session are recognised.
  const isSameRepositoryWorktreePath = (path: string) =>
    sameRepositoryWorktrees(root).some((worktree) => isWithin(worktree, path));

  return async (event: ToolCallEvent, ctx: { hasUI: boolean; ui: { select: (title: string, options: string[]) => Promise<string | undefined> } }) => {
    if (FILE_TOOLS.has(event.toolName)) {
      const input = event.input as { path?: unknown };
      if (typeof input.path === "string") {
        const inspection = inspectPath(root, input.path);
        const isWrite = !READ_TOOLS.has(event.toolName);
        if (isWrite && inspection.resolved
          && isControlPlaneWriteBlocked(root, inspection.resolved, CODING_HARNESS_ROOT, PI_PLUGINS_ROOT, getSessionTempDirectory())) {
          return block(`${input.path}: agent control-plane writes require a coding-harness session`);
        }
        if (inspection.reason && !inspection.outside) return block(`${input.path}: ${inspection.reason}`);
        if (inspection.outside) {
          if (!inspection.resolved) return block(`${input.path}: ${inspection.reason}`);
          if (isSessionTempPath(inspection.resolved) || isPluginWorkspacePath(inspection.resolved)) return undefined;
          if (canReadSessionHistory(event.toolName, inspection.resolved)) {
            if (["grep", "find"].includes(event.toolName) && !isSafeSessionHistoryTree(inspection.resolved)) {
              return block(`${input.path}: recursive session-history reads cannot traverse symlinks or protected paths`);
            }
            return undefined;
          }
          if (event.toolName === "read" && repositoryRoot && typeof input.path === "string"
            && await isRepositorySessionTranscript(configuredHistoryRoot, input.path, repositoryRoot)) return undefined;
          if (hasResearchVaultReadAccess(event.toolName, inspection.resolved, resolvedResearchVaultRoot)) return undefined;
          if (isWithin(resolvedResearchVaultRoot, inspection.resolved) && isWrite) {
            if (await requestResearchVaultConfirmation(ctx, event.toolName, inspection.resolved)) return undefined;
            return block(`${input.path}: research-vault ${event.toolName} denied by user`);
          }
          if (!READ_TOOLS.has(event.toolName)) return block(`${input.path}: ${inspection.reason}`);
          if (isSameRepositoryWorktreePath(inspection.resolved)) return undefined;
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

      if (permitsSessionHistoryCommand(event.input.command, root, CODING_HARNESS_ROOT)
        && realpathForCheck(historyHelper) === historyHelper
        && (!event.input.command.startsWith("bun ~/") || realpathForCheck(installedHistoryHelper) === historyHelper)) return undefined;

      const vaultOperation = researchVaultBashOperation(event.input.command, resolvedResearchVaultRoot);
      const vaultOperationPathsAreSafe = hasSafeResearchVaultBashPaths(event.input.command, resolvedResearchVaultRoot);
      if (vaultOperation && !vaultOperationPathsAreSafe) {
        return block("documented research-vault command resolves outside the vault or to a protected secret path");
      }
      if (vaultOperation === "mutation") {
        if (!await requestResearchVaultConfirmation(ctx, "Bash hash update", resolvedResearchVaultRoot)) {
          return block("research-vault Bash mutation denied by user");
        }
        grantCommandRoots(event.input.command, [resolvedResearchVaultRoot]);
        return undefined;
      }
      if (vaultOperation === "read") return undefined;

      const directoryContext = {
        cwd: root,
        home: homedir(),
        realpath: realpathForCheck,
        // `cd` needs search permission, not only a directory.
        isDirectory: (path: string) => {
          try {
            accessSync(path, constants.X_OK);
            return statSync(path).isDirectory();
          } catch {
            return false;
          }
        },
        variables: sessionTempDirectory ? { PI_SESSION_TMPDIR: sessionTempDirectory } : undefined,
      };
      const readOnlyInspection = isReadOnlyInspectionCommand(event.input.command);
      for (const candidate of shellPathCandidates(event.input.command, directoryContext)) {
        const path = candidate.startsWith("~") ? join(process.env.HOME ?? "~", candidate.slice(1)) : candidate;
        if (namesMissingRootEntry(path.replace(/^@/, ""))) continue;
        const inspection = inspectPath(root, path);
        if (inspection.resolved === historyHelper) {
          return block("session-history helper requires the documented read-only command from the coding-harness root");
        }
        const rootVerifierScript = inspection.resolved
          && isWithin(root, inspection.resolved)
          && (inspection.resolved === join(root, ".agent", "verify.sh")
            || inspection.resolved === join(root, ".agent", "diagnostics.sh"));
        if (rootVerifierScript && !permitsRootVerifierScriptBashReference(event.input.command, root, inspection.resolved!)) {
          return block(`${candidate}: Bash execution of repository verifier scripts is blocked`);
        }
        if (inspection.resolved
          && isControlPlaneWriteBlocked(root, inspection.resolved, CODING_HARNESS_ROOT, PI_PLUGINS_ROOT, sessionTempDirectory)) {
          return block(`${candidate}: Bash access to the agent control plane requires a coding-harness session`);
        }
        const permittedOutsidePath = inspection.outside && inspection.resolved
          && (isSessionTempPath(inspection.resolved)
            || isPluginWorkspacePath(inspection.resolved)
            || isTrustedSharedSkillHelper(inspection.resolved, CODING_HARNESS_SHARED_ROOT)
            || isSameRepositoryWorktreePath(inspection.resolved)
            || (readOnlyInspection && isWithin(PI_PACKAGES_ROOT, inspection.resolved)));
        if (inspection.reason && !permittedOutsidePath) {
          if (inspection.outside && inspection.resolved && canReadSessionHistory("read", inspection.resolved)) {
            return block(`${candidate}: general Bash access to session history is blocked, but transcript reads are allowed here. `
              + 'Discover matching sessions with: bun pi/agent/extensions/sandbox/session-history.ts --match "search-term" --limit 25. '
              + 'Replace "search-term" with the topic, then use the read tool on the returned paths. No export or permission change is needed for this workflow.');
          }
          return block(`${candidate}: ${inspection.reason}`);
        }
      }

      const confirmation = confirmedCommand(event.input.command);
      if (confirmation && !await requestCommandConfirmation(ctx, confirmation, event.input.command)) {
        return block(ctx.hasUI
          ? `${confirmation.program} command denied by user`
          : `${confirmation.program} commands require interactive approval`);
      }

      // Without a UI the command still runs, confined without the credentials.
      const azureProgram = azureCredentialProgram(event.input.command);
      if (azureProgram && (azureApprovedForSession || ctx.hasUI)) {
        const approval = azureApprovedForSession
          ? "session"
          : await requestAzureCredentials(ctx, azureProgram, event.input.command);
        if (approval === "denied") return block(`${azureProgram} access to Azure credentials denied by user`);
        if (approval === "session") azureApprovedForSession = true;
        grantCommandRoots(event.input.command, [AZURE_CONFIG_ROOT]);
      }
    }

    return undefined;
  };
}

/** `commandGrants` maps exact command texts to roots the user approved for that command's next run. */
function registerCommandSandbox(
  pi: ExtensionAPI,
  getSessionTempDirectory: () => string | undefined,
  commandGrants: Map<string, string[]>,
): void {
  const mode = commandSandboxMode();
  if (mode.kind === "unconfined") {
    if (mode.reason === "disabled") {
      pi.on("session_start", (_event, ctx) => {
        ctx.ui.notify(`Command sandbox disabled by ${DISABLE_VARIABLE}=off: Bash runs unconfined`, "warning");
      });
    }
    return;
  }

  const root = realpathSync.native(process.cwd());
  const home = realpathSync.native(homedir());
  const confine = ({ command, cwd, env }: BashSpawnContext): BashSpawnContext => {
    if (mode.kind === "unavailable") {
      throw new Error(`Command sandbox unavailable (${mode.reason}); refusing to run unconfined. `
        + `Start Pi with ${DISABLE_VARIABLE}=off to run commands without it.`);
    }
    const sessionTempDirectory = getSessionTempDirectory();
    const grantedRoots = commandGrants.get(command) ?? [];
    commandGrants.delete(command);
    const profile = commandSandboxProfile(commandSandboxScope({
      root,
      home,
      agentDirectory: realpathForCheck(getAgentDir()),
      sessionTempDirectory,
      sessionTempParent: TEMP_PARENT && realpathForCheck(TEMP_PARENT),
      systemTempDirectory: TEMP_ROOT,
      codingHarnessRoot: CODING_HARNESS_ROOT,
      researchVaultRoot: RESEARCH_VAULT_ROOT,
      approvedRoots: grantedRoots,
    }));
    return { command: confinedShellCommand(command, profile), cwd, env: confinedEnvironment(env, sessionTempDirectory) };
  };

  pi.registerTool(createBashToolDefinition(root, { spawnHook: confine }));
  const local = createLocalBashOperations();
  pi.on("user_bash", () => ({
    operations: {
      exec(command, cwd, options) {
        // A command the user typed is their own approval for the Azure credentials.
        if (azureCredentialProgram(command)) commandGrants.set(command, [AZURE_CONFIG_ROOT]);
        const confined = confine({ command, cwd, env: options.env ?? process.env });
        return local.exec(confined.command, confined.cwd, { ...options, env: confined.env });
      },
    },
  }));
  if (mode.kind === "unavailable") {
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.notify(`Command sandbox unavailable (${mode.reason}): Bash commands will be refused`, "error");
    });
  }
}

export default function sandboxExtension(pi: ExtensionAPI) {
  registerRecentSessionsTool(pi, process.cwd());
  let sessionTempDirectory: string | undefined;
  const commandGrants = new Map<string, string[]>();
  const guard = createSandboxGuard(
    process.cwd(),
    () => sessionTempDirectory,
    RESEARCH_VAULT_ROOT,
    (command, roots) => commandGrants.set(command, roots),
  );
  registerCommandSandbox(pi, () => sessionTempDirectory, commandGrants);

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
      systemPrompt: `${event.systemPrompt}\n\nSession temporary workspace: ${sessionTempDirectory}\nUse this directory for disposable clones, generated analysis, and other scratch artifacts instead of placing them in the repository root. It is also available to Bash commands as $PI_SESSION_TMPDIR.`,
    };
  });

  pi.on("session_shutdown", () => {
    if (process.env.PI_SESSION_TMPDIR === sessionTempDirectory) delete process.env.PI_SESSION_TMPDIR;
    sessionTempDirectory = undefined;
  });

  pi.on("tool_call", (event, ctx) => guard(event, ctx));
}
