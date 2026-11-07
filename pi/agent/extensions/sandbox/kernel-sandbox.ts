import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { isTrackedEnvTemplate, isWithin, sameRepositoryWorktrees } from "./policy.ts";

/**
 * Kernel (Seatbelt) confinement for shell commands Pi runs. Normally only the commands are confined, not Pi itself:
 * macOS refuses to apply a sandbox inside a sandboxed process, so a confined Pi could not give its commands
 * less access than it needs for its own credentials. Confidential mode is the exception: there the whole Pi
 * process runs under `confidentialSandboxProfile`, which its commands inherit.
 */
export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
/** Set at Pi launch to run commands unconfined while tuning the profile. */
export const DISABLE_VARIABLE = "PI_COMMAND_SANDBOX";
/** Marks commands, and any Pi started by them, as already confined; macOS rejects a nested profile. */
export const ACTIVE_VARIABLE = "PI_COMMAND_SANDBOX_ACTIVE";
/**
 * Egress policy of the confining profile: `proxied` for model commands, `open` for user `!` commands, and
 * `local-model` for a Pi started by the confidential-mode launcher. A Pi started inside a profile inherits it, so its
 * model commands are restricted only when this says `proxied` or `local-model`.
 */
export const EGRESS_VARIABLE = "PI_COMMAND_SANDBOX_EGRESS";
export type CommandEgress = "proxied" | "open";
export type InheritedEgress = CommandEgress | "local-model";

export interface CommandSandboxScope {
  home: string;
  /** Reads below these roots are denied unless `readable` allows them. */
  unreadableRoots: string[];
  readable: string[];
  writable: string[];
  /** Denied even inside readable or writable roots. */
  unreadable: string[];
  /** Readable despite matching a secret name: tracked `.env.example` templates the lexical guard also permits. */
  readableExceptions: string[];
  unwritable: string[];
  /** Exact paths that must not be created, renamed or removed, such as ancestors of denied subtrees. */
  unwritableLiterals: string[];
  /** Git common directory whose worktree pointer records must not be rewritten (SBX-36). */
  gitCommonDirectory: string | undefined;
  /** Project content where secret file names stay unreadable and cannot be renamed, linked or replaced. */
  secretScanRoots: string[];
  /** Always writable, even below an `unwritable` root such as the shared session temp parent. */
  sessionDirectory: string | undefined;
  /** Loopback port of the egress proxy; when set, every other outbound IP connection is denied. Unset leaves egress open. */
  egressProxyPort: number | undefined;
}

/**
 * Loopback ports commands may reach directly, for dev servers and browser tests. 5000 is left out because macOS
 * AirPlay Receiver listens on it.
 */
export const LOCAL_SERVICE_PORTS = [3000, 4173, 4317, 5173, 5190, 8000, 8020, 8080];

/**
 * Secret file names, mirroring the lexical guard's patterns. They are applied only below `secretScanRoots`:
 * toolchains legitimately ship `.pem` certificate bundles.
 */
const SECRET_NAME_PATTERN = String.raw`(\.env(/|[./][^/]*$|$)|(\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.gcloud|\.config/gcloud|Library/Keychains)(/|$)|\.docker/config\.json$|credentials\.json$|service-account[^/]*\.json$|id_rsa$|id_ed25519$|\.netrc$|\.npmrc$|\.pypirc$|[^/]+\.(pem|key)$)`;

const SECRET_ENVIRONMENT_NAME = /(?:^|_)(?:API_?KEY|ACCESS_KEY|KEY|TOKEN|PAT|AUTH|PASSWORD|PASSWD|CREDENTIALS?)$|SECRET/i;
/** Startup hooks the outer, unconfined shell would run before it execs `sandbox-exec`. */
const SHELL_STARTUP_VARIABLE = /^(?:BASH_ENV|ENV)$|^BASH_FUNC_/;

/**
 * Mach services that start programs outside the caller's sandbox: LaunchServices (`open`) and Apple Events
 * (`osascript` driving another app). Measured: `open -a` launched an app from a confined command until denied.
 */
const ESCAPE_SERVICES = [
  '(global-name "com.apple.coreservices.launchservicesd")',
  '(global-name-prefix "com.apple.lsd.")',
  '(global-name "com.apple.coreservices.appleevents")',
];
/**
 * Daemons that reach the network for the caller even when every outbound connection is denied: mDNSResponder for
 * DNS and nsurlsessiond for background URL sessions.
 */
const NETWORK_PROXY_SERVICES = ['(global-name "com.apple.dnssd.service")', '(global-name "com.apple.nsurlsessiond")'];

function sbplString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function rule(action: string, operation: string, filters: string[]): string[] {
  return filters.length === 0 ? [] : [`(${action} ${operation}`, ...filters.map((filter) => `  ${filter}`), ")"];
}

const subpaths = (paths: string[]) => paths.map((path) => `(subpath ${sbplString(path)})`);
const literals = (paths: string[]) => paths.map((path) => `(literal ${sbplString(path)})`);

/** `#"…"` regex literals take backslashes verbatim and cannot carry a double quote. */
function regexPath(root: string): string {
  if (root.includes('"')) throw new Error(`cannot confine commands below a path containing a double quote: ${root}`);
  return root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const secretNameRegex = (root: string) => `(regex #"^${regexPath(root)}/(.*/)?${SECRET_NAME_PATTERN}")`;
const SECRET_DIRECTORY_PATTERN = String.raw`(\.env|\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.gcloud|\.config/gcloud|Library/Keychains)/`;
const secretDirectoryRegex = (root: string) => `(regex #"^${regexPath(root)}/(.*/)?${SECRET_DIRECTORY_PATTERN}")`;
/** certifi's public CA bundle, which HTTP clients such as httpx read when they are constructed. Read-only. */
const certifiBundleRegex = (root: string) => `(regex #"^${regexPath(root)}/(.*/)?certifi/cacert\\.pem$")`;
/** Creating or renaming a `certifi` directory would move another `cacert.pem` under the bundle exception. */
const certifiDirectoryRegex = (root: string) => `(regex #"^${regexPath(root)}/(.*/)?certifi$")`;

/** A planted `commondir`, `gitdir` or `config.worktree` makes host Git load agent-written config (SBX-36). */
function gitPointerFilters(commonDirectory: string | undefined): string[] {
  if (!commonDirectory) return [];
  return [
    ...literals([join(commonDirectory, "commondir"), join(commonDirectory, "config.worktree")]),
    `(regex #"^${regexPath(commonDirectory)}/worktrees/[^/]+/(commondir|gitdir|config\.worktree)$")`,
  ];
}

/** Seatbelt applies the last matching rule, so each allow list is followed by its exceptions. */
export function commandSandboxProfile(scope: CommandSandboxScope): string {
  const session = scope.sessionDirectory ? [scope.sessionDirectory] : [];
  return [
    "(version 1)",
    "(allow default)",
    ...rule("deny", "file-read-data", subpaths(scope.unreadableRoots)),
    ...rule("allow", "file-read-data", subpaths([...scope.readable, ...session])),
    ...rule("deny", "file-read-data", [...subpaths(scope.unreadable), ...scope.secretScanRoots.map(secretNameRegex)]),
    ...rule("allow", "file-read-data", scope.secretScanRoots.map(certifiBundleRegex)),
    ...rule("deny", "file-read-data", [...subpaths(scope.unreadable), ...scope.secretScanRoots.map(secretDirectoryRegex)]),
    ...rule("allow", "file-read-data", literals(scope.readableExceptions)),
    ...rule("deny", "file-write*", ['(subpath "/")']),
    ...rule("allow", "file-write*", subpaths(scope.writable)),
    ...rule("deny", "file-write*", subpaths(scope.unwritable)),
    ...rule("allow", "file-write*", subpaths(session)),
    // Path rules follow names, so renaming a secret or a denied subtree's ancestor would escape them.
    ...rule("deny", "file-write*", [
      ...literals(scope.unwritableLiterals),
      ...gitPointerFilters(scope.gitCommonDirectory),
      ...scope.secretScanRoots.map(secretNameRegex),
      ...scope.secretScanRoots.map(certifiDirectoryRegex),
    ]),
    ...rule("deny", "network-outbound", [
      scope.egressProxyPort === undefined ? '(remote ip "localhost:*")' : '(remote ip "*:*")',
      `(remote unix-socket (subpath ${sbplString(scope.home)}))`,
    ]),
    ...rule("allow", "network-outbound", [
      ...LOCAL_SERVICE_PORTS,
      ...(scope.egressProxyPort === undefined ? [] : [scope.egressProxyPort]),
    ].map((port) => `(remote ip "localhost:${port}")`)),
    ...rule("deny", "mach-lookup", ESCAPE_SERVICES),
    "",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** The returned text runs in Pi's shell, which immediately replaces itself with the confined one. */
export function confinedShellCommand(command: string, profile: string): string {
  return `exec ${SANDBOX_EXEC} -p ${shellQuote(profile)} /bin/bash -c ${shellQuote(command)}`;
}

export function confinedEnvironment(
  env: NodeJS.ProcessEnv,
  sessionTempDirectory: string | undefined,
  egress: CommandEgress,
  proxyVariables: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const confined: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (!SECRET_ENVIRONMENT_NAME.test(name) && !SHELL_STARTUP_VARIABLE.test(name)) confined[name] = value;
  }
  Object.assign(confined, proxyVariables);
  if (sessionTempDirectory) confined.TMPDIR = `${sessionTempDirectory}/`;
  confined[ACTIVE_VARIABLE] = "1";
  confined[EGRESS_VARIABLE] = egress;
  return confined;
}

export type CommandSandboxMode =
  | { kind: "confine" }
  | { kind: "unconfined"; reason: "disabled" | "unsupported-platform" }
  /** The inherited profile already limits egress; Pi cannot apply its own inside it. */
  | { kind: "unconfined"; reason: "already-confined"; inheritedEgress: InheritedEgress }
  | { kind: "unavailable"; reason: string };

/**
 * The marker variable alone is forgeable, so it is trusted only when applying a fresh profile fails the way it
 * does inside an existing sandbox.
 */
export function processIsConfined(): boolean {
  const probe = spawnSync(SANDBOX_EXEC, ["-p", "(version 1)(allow default)", "/usr/bin/true"], { encoding: "utf8" });
  return probe.status !== 0 && probe.stderr.includes("sandbox_apply");
}

export function commandSandboxMode(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  isConfined: () => boolean = processIsConfined,
): CommandSandboxMode {
  if (env[DISABLE_VARIABLE] === "off") return { kind: "unconfined", reason: "disabled" };
  // shortcut: Linux sessions (paseo-box) rely on the container boundary; add Landlock if Pi runs on a bare Linux host.
  if (platform !== "darwin") return { kind: "unconfined", reason: "unsupported-platform" };
  if (!existsSync(SANDBOX_EXEC)) return { kind: "unavailable", reason: `${SANDBOX_EXEC} is missing` };
  if (env[ACTIVE_VARIABLE] === "1" && isConfined()) {
    // Anything but an explicit restricted marker is treated as open egress, so a missing marker fails closed.
    const marker = env[EGRESS_VARIABLE];
    const inheritedEgress = marker === "proxied" || marker === "local-model" ? marker : "open";
    return { kind: "unconfined", reason: "already-confined", inheritedEgress };
  }
  return { kind: "confine" };
}

function realpathIfExists(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

function gitOutput(cwd: string, args: string[]): string | undefined {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_CEILING_DIRECTORIES"]) delete env[key];
  try {
    return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env,
    }).trim();
  } catch {
    return undefined;
  }
}

function expandHome(path: string, home: string): string {
  return path === "~" || path.startsWith("~/") ? join(home, path.slice(1)) : path;
}

/**
 * Toolchain prefixes under home, e.g. ~/.volta for ~/.volta/bin, so tools and their libraries resolve.
 * Pi itself adds a bin directory inside its agent directory to PATH; that prefix would expose its credentials.
 */
export function homeToolchainRoots(home: string, agentDirectory: string, pathVariable: string | undefined): string[] {
  const roots: string[] = [];
  for (const entry of (pathVariable ?? "").split(":")) {
    const bin = isAbsolute(entry) ? realpathIfExists(entry) : undefined;
    if (!bin || basename(bin) !== "bin") continue;
    const prefix = dirname(bin);
    if (prefix === home || !isWithin(home, prefix)) continue;
    if (isWithin(prefix, agentDirectory) || isWithin(agentDirectory, prefix)) continue;
    roots.push(prefix);
  }
  return roots;
}

/** Git paths for commit signing that live under home and therefore need an explicit read allowance. */
function gitSigningFiles(root: string, home: string): string[] {
  return ["user.signingkey", "gpg.ssh.allowedSignersFile"]
    .map((key) => gitOutput(root, ["config", "--get", key]) ?? "")
    .filter((value) => /^[~/]/.test(value))
    .map((value) => expandHome(value, home));
}

const HOME_READABLE = [".gitconfig", ".config/git", ".ssh/known_hosts", ".ssh/config"];
const HOME_CACHES = [".cache", "Library/Caches", ".npm", ".bun/install/cache"];
/** Readable, not writable: they hold interpreters and tools that unconfined processes later execute. */
const HOME_TOOL_STORES = [".local/share/uv"];
/** Executable content inside writable caches that unconfined processes (MCP servers, Claude Code) run. */
const EXECUTABLE_CACHES = [".npm/_npx", "Library/Caches/ms-playwright", ".cache/pre-commit"];

function trackedEnvTemplates(root: string): string[] {
  const listed = gitOutput(root, ["ls-files", "-z", "--", ":(glob)**/.env.example"]) ?? "";
  return listed.split("\0").filter(Boolean).map((path) => join(root, path))
    .filter((path) => isTrackedEnvTemplate(path, root));
}

export interface CommandSandboxContext {
  root: string;
  home: string;
  agentDirectory: string;
  sessionTempDirectory: string | undefined;
  /** Parent of every session temp directory; siblings of the current one stay unreadable and unwritable. */
  sessionTempParent: string | undefined;
  /** The per-user system temp directory, which macOS `mktemp` uses regardless of TMPDIR. */
  systemTempDirectory: string;
  codingHarnessRoot: string;
  researchVaultRoot: string;
  /** Readable and writable for this command only, after the user approved it (vault hash update, Azure CLI). */
  approvedRoots?: string[];
  egressProxyPort: number | undefined;
}

/** Derives the confinement scope from host facts: the checkout's Git layout, PATH, and Git signing config. */
function gitCommonDirectory(root: string): string | undefined {
  const output = gitOutput(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return output ? realpathIfExists(output) : undefined;
}

export function commandSandboxScope(context: CommandSandboxContext): CommandSandboxScope {
  const { root, home, agentDirectory, sessionTempDirectory, codingHarnessRoot } = context;
  const commonDirectory = gitCommonDirectory(root);
  const worktrees = sameRepositoryWorktrees(root, home);
  const isHarnessRepository = root === codingHarnessRoot || worktrees.includes(codingHarnessRoot);
  const caches = HOME_CACHES.map((path) => join(home, path));
  const sessionParent = context.sessionTempParent ? [context.sessionTempParent] : [];
  const git = commonDirectory ? [commonDirectory] : [];
  const toolStores = HOME_TOOL_STORES.map((path) => join(home, path));

  return {
    home,
    unreadableRoots: [home, ...sessionParent],
    readable: [
      root,
      ...git,
      ...worktrees,
      ...caches,
      ...toolStores,
      ...HOME_READABLE.map((path) => join(home, path)),
      ...gitSigningFiles(root, home),
      ...homeToolchainRoots(home, agentDirectory, process.env.PATH),
      join(codingHarnessRoot, "shared"),
      context.researchVaultRoot,
      ...(context.approvedRoots ?? []),
      // SBX-16: only harness-maintenance sessions inspect session history from Bash.
      ...(isHarnessRepository ? [join(agentDirectory, "sessions")] : []),
    ],
    writable: [
      root, ...git, ...caches, context.systemTempDirectory, "/private/tmp", "/private/var/tmp", "/dev",
      ...(context.approvedRoots ?? []),
    ],
    // Seatbelt matches resolved paths, so a linked credential file is denied at its target.
    unreadable: ["auth.json", "mcp-auth.json"].map((name) => realpathIfExists(join(agentDirectory, name)) ?? join(agentDirectory, name)),
    readableExceptions: trackedEnvTemplates(root),
    secretScanRoots: [root, ...worktrees, ...(sessionTempDirectory ? [sessionTempDirectory] : []), context.researchVaultRoot],
    sessionDirectory: sessionTempDirectory,
    unwritable: [
      ...sessionParent,
      ...EXECUTABLE_CACHES.map((path) => join(home, path)),
      // SBX-36: Git on the host executes hooks and config such as core.fsmonitor.
      ...(commonDirectory ? [join(commonDirectory, "config"), join(commonDirectory, "hooks")] : []),
    ],
    // Replacing `.git` or the common directory, or renaming the temp directory, would redirect or expose them.
    unwritableLiterals: [join(root, ".git"), ...git, context.systemTempDirectory],
    gitCommonDirectory: commonDirectory,
    egressProxyPort: context.egressProxyPort,
  };
}

export interface ConfidentialSandboxContext {
  root: string;
  home: string;
  agentDirectory: string;
  systemTempDirectory: string;
  /** Loopback port of the local model server, the only network destination. */
  modelPort: number;
}

/**
 * Whole-process profile for confidential mode: Pi, its extensions, MCP servers and commands may connect only to the
 * local model port. Reads stay open because nothing can leave the machine; writes are limited so data cannot reach a
 * synced folder or plant Git hooks or config that later run unconfined. LaunchServices, Apple Events, DNS and
 * URL sessions are denied because they reach the network through other processes. Inbound connections are not
 * restricted: a `network-bind` rule limited to loopback still allowed binding 0.0.0.0 (measured).
 */
export function confidentialSandboxProfile(context: ConfidentialSandboxContext): string {
  const { root, home, agentDirectory, systemTempDirectory, modelPort } = context;
  const commonDirectory = gitCommonDirectory(root);
  const git = commonDirectory ? [commonDirectory] : [];
  const sessions = join(agentDirectory, "sessions");
  // Pi takes proper-lockfile locks (`<file>.lock` directories) even to read trust, settings and auth. The files
  // themselves stay read-only: settings and trust decide what an unconfined Pi later loads and runs.
  const agentLocks = `(regex #"^${regexPath(agentDirectory)}/[^/]+\\.lock(/|$)")`;
  // pi-status-footer records usage data, which nothing executes, by renaming a temporary file over it.
  const usageRecord = `(regex #"^${regexPath(agentDirectory)}/consumption\\.json(\\.[0-9]+\\.tmp)?$")`;
  return [
    "(version 1)",
    "(allow default)",
    ...rule("deny", "file-write*", ['(subpath "/")']),
    ...rule("allow", "file-write*", [
      ...subpaths([
        root, ...git, ...HOME_CACHES.map((path) => join(home, path)), systemTempDirectory, "/private/tmp",
        "/private/var/tmp", "/dev", realpathIfExists(sessions) ?? sessions,
      ]),
      agentLocks,
      usageRecord,
      ...literals([join(agentDirectory, "crashes.json")]),
    ]),
    ...rule("deny", "file-write*", [
      ...subpaths([
        ...EXECUTABLE_CACHES.map((path) => join(home, path)),
        ...(commonDirectory ? [join(commonDirectory, "config"), join(commonDirectory, "hooks")] : []),
      ]),
      ...literals([join(root, ".git"), ...git, systemTempDirectory]),
      ...gitPointerFilters(commonDirectory),
    ]),
    "(deny network-outbound)",
    ...rule("allow", "network-outbound", [`(remote ip "localhost:${modelPort}")`]),
    ...rule("deny", "mach-lookup", [...ESCAPE_SERVICES, ...NETWORK_PROXY_SERVICES]),
    "",
  ].join("\n");
}
