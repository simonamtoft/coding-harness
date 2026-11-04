import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { parseSessionHistoryExtraction } from "./session-history-command.ts";
import { shellSegments, type ShellDirectoryContext } from "./shell-directories.ts";
import { isSideEffectFreeSedProgram, literalSecretCandidates, maskNonPathText } from "./shell-path-text.ts";

const POSIX_NULL_DEVICE = "/dev/null";

const DOT_ENV_PATTERN = /(^|\/)\.env(?:[./]|$)/;
const SECRET_PATTERNS = [
  DOT_ENV_PATTERN,
  /(^|\/)(?:\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.gcloud)(?:\/|$)/,
  /(^|\/)(?:credentials\.json|service-account[^/]*\.json|id_rsa|id_ed25519|\.netrc|\.npmrc|\.pypirc)$/,
  /(^|\/)\.config\/gcloud(?:\/|$)/,
  /(^|\/)Library\/Keychains(?:\/|$)/,
  /(^|\/)\.docker\/config\.json$/,
  // A non-empty stem not ending in jq or shell syntax, so `.key` and `\(.key` accessors are not key files.
  /(^|\/)[^/]*[^/(|[\]\\"'`]\.(?:pem|key)$/,
];

export function isWithin(root: string, path: string): boolean {
  const distance = relative(root, path);
  return distance === "" || (distance !== ".." && !distance.startsWith(`..${sep}`) && !isAbsolute(distance));
}

export function hasTrustedSharedReadAccess(
  toolName: string,
  targetPath: string,
  codingHarnessSharedRoot: string,
): boolean {
  return toolName === "read" && isWithin(codingHarnessSharedRoot, targetPath);
}

export function isTrustedSharedSkillHelper(targetPath: string, codingHarnessSharedRoot: string): boolean {
  if (isProtectedSecretPath(targetPath) || !isWithin(codingHarnessSharedRoot, targetPath)) return false;
  const relativePath = relative(codingHarnessSharedRoot, targetPath).split(sep);
  if (relativePath.length !== 4 || relativePath[0] !== "skills" || relativePath[2] !== "scripts") return false;
  if (relativePath[3]!.endsWith(".sh")) return true;
  return TRUSTED_NODE_HELPERS.get(relativePath[1]!)?.includes(relativePath[3]!) ?? false;
}

/** SBX-17, SBX-40: Node helpers that restrict their own indirect filesystem inputs. */
const TRUSTED_NODE_HELPERS = new Map<string, readonly string[]>([
  ["visual-verification", ["capture-pages.mjs", "capture-scenario.mjs"]],
  ["present", ["build-report.mjs", "validate-report.mjs", "render-report.mjs"]],
]);

export function hasSessionHistoryReadAccess(
  toolName: string,
  sessionRoot: string,
  targetPath: string,
  codingHarnessRoot: string,
  historyRoot: string,
): boolean {
  return sessionRoot === codingHarnessRoot
    && ["read", "grep", "find", "ls"].includes(toolName)
    && isWithin(historyRoot, targetPath)
    && !isProtectedSecretPath(targetPath);
}

export function permitsSessionHistoryCommand(command: string, sessionRoot: string, codingHarnessRoot: string): boolean {
  const helper = "pi/agent/extensions/sandbox/session-history.ts";
  const absoluteHelper = join(codingHarnessRoot, helper);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const recentScript = `(?:${escape(absoluteHelper)}|~/\\.pi/agent/extensions/sandbox/session-history\\.ts)`;
  if (new RegExp(`^bun ${recentScript} --recent --limit (?:[1-9]|[1-9][0-9]|100)$`).test(command)) return true;
  if (sessionRoot !== codingHarnessRoot) return false;
  const script = `(?:${escape(helper)}|${escape(absoluteHelper)})`;
  // One literal query argument, no shell expansion, chaining, or redirection.
  const query = `(?:[A-Za-z0-9._-]+|"[A-Za-z0-9 ._-]+"|'[A-Za-z0-9 ._-]+')`;
  if (command.includes("\n") || command.includes("\r")) return false;
  if (new RegExp(`^bun ${script} --audit-(?:bulk-reads|blocks|asks) --limit (?:[1-9]|[1-9][0-9]|1[0-9][0-9]|200)$`).test(command)) return true;
  if (new RegExp(`^bun ${script} --match ${query} --limit (?:[1-9]|[1-9][0-9]|100)$`).test(command)) return true;
  const extraction = new RegExp(`^bun ${script} (.+)$`).exec(command);
  return extraction !== null && parseSessionHistoryExtraction(extraction[1]!.split(" ")) !== undefined;
}

export function hasResearchVaultReadAccess(toolName: string, targetPath: string, researchVaultRoot: string): boolean {
  return toolName === "read" && isWithin(researchVaultRoot, targetPath);
}

type ResearchVaultBashOperation = { type: "read" | "mutation"; paths: string[] };

function classifyResearchVaultBashOperation(command: string, researchVaultRoot: string): ResearchVaultBashOperation | undefined {
  const root = researchVaultRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const safeRelativePath = "[A-Za-z0-9._/-]+";
  const cdPrefix = `cd ${root} && `;
  const statusScript = `${researchVaultRoot}/bin/status.py`;
  const mhtmlScript = `${researchVaultRoot}/bin/mhtml2txt.py`;

  if (new RegExp(`^(?:${cdPrefix}python3 bin/status\\.py|python3 ${root}/bin/status\\.py) --write-hashes$`).test(command)) {
    return { type: "mutation", paths: [statusScript] };
  }
  if (new RegExp(`^(?:${cdPrefix}python3 bin/status\\.py|python3 ${root}/bin/status\\.py)$`).test(command)) {
    return { type: "read", paths: [statusScript] };
  }

  const relativeMhtml = new RegExp(`^${cdPrefix}python3 bin/mhtml2txt\\.py (raw/${safeRelativePath})$`).exec(command);
  if (relativeMhtml) return { type: "read", paths: [mhtmlScript, join(researchVaultRoot, relativeMhtml[1])] };
  const absoluteMhtml = new RegExp(`^python3 ${root}/bin/mhtml2txt\\.py (${root}/raw/${safeRelativePath})$`).exec(command);
  if (absoluteMhtml) return { type: "read", paths: [mhtmlScript, absoluteMhtml[1]] };

  const relativePdf = new RegExp(`^${cdPrefix}pdftotext (raw/${safeRelativePath}) -$`).exec(command);
  if (relativePdf) return { type: "read", paths: [join(researchVaultRoot, relativePdf[1])] };
  const absolutePdf = new RegExp(`^pdftotext (${root}/raw/${safeRelativePath}) -$`).exec(command);
  if (absolutePdf) return { type: "read", paths: [absolutePdf[1]] };
  return undefined;
}

export function researchVaultBashOperation(command: string, researchVaultRoot: string): "read" | "mutation" | undefined {
  return classifyResearchVaultBashOperation(command, researchVaultRoot)?.type;
}

export function researchVaultBashPaths(command: string, researchVaultRoot: string): string[] {
  return classifyResearchVaultBashOperation(command, researchVaultRoot)?.paths ?? [];
}

export function hasSafeResearchVaultBashPaths(command: string, researchVaultRoot: string): boolean {
  if (!existsSync(researchVaultRoot)) return false;
  const resolvedVaultRoot = realpathSync.native(researchVaultRoot);
  const paths = researchVaultBashPaths(command, researchVaultRoot);
  return paths.length > 0 && paths.every((path) => {
    if (!existsSync(path)) return false;
    const resolved = realpathSync.native(path);
    return !isProtectedSecretPath(resolved) && isWithin(resolvedVaultRoot, resolved);
  });
}

export async function requestResearchVaultConfirmation(
  ctx: { hasUI: boolean; ui: { select: (title: string, options: string[]) => Promise<string | undefined> } },
  operation: string,
  target: string,
): Promise<boolean> {
  if (!ctx.hasUI) return false;
  const choice = await ctx.ui.select(
    `Allow research-vault operation?\nOperation: ${operation}\nTarget: ${target}`,
    ["Allow once", "Deny"],
  );
  return choice === "Allow once";
}

export function hasPluginWorkspaceAccess(
  sessionRoot: string,
  targetPath: string,
  codingHarnessRoot: string,
  pluginWorkspaceRoot: string,
): boolean {
  const trustedSession = isWithin(codingHarnessRoot, sessionRoot) || isWithin(pluginWorkspaceRoot, sessionRoot);
  return trustedSession && isWithin(pluginWorkspaceRoot, targetPath);
}

export function isProtectedSecretPath(path: string): boolean {
  const normalized = normalize(path);
  return SECRET_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * SBX-30: shell text naming only dot-env files below the working directory, which an existence or ignore probe or
 * stored message text may mention without exposing contents. Other protected names, absolute or home paths, parent
 * segments, and expansions do not qualify.
 */
function isDotEnvProbeOperand(value: string): boolean {
  if (/^[~/]/.test(value) || /(?:^|\/)\.\.(?:\/|$)/.test(value) || /[$`]/.test(value)) return false;
  return DOT_ENV_PATTERN.test(value)
    && SECRET_PATTERNS.every((pattern) => pattern === DOT_ENV_PATTERN || !pattern.test(value));
}

/**
 * Whether an absolute path's top-level entry is missing. A user process can neither read nor create entries directly
 * under `/`, so such text (an Azure resource ID, a container path, a format string) names no host file. A first
 * segment with glob or expansion characters may expand to a real entry, and a backslash may escape one.
 */
export function namesMissingRootEntry(path: string): boolean {
  const top = /^\/([^/]+)/.exec(path)?.[1];
  if (!top || /[*?[{$`]/.test(top)) return false;
  return [top, top.replace(/\\(.)/g, "$1")].every((name) => {
    try {
      lstatSync(join("/", name));
      return false;
    } catch {
      return true;
    }
  });
}

const ENV_TEMPLATE_NAME = ".env.example";

/**
 * SBX-02 exception: a regular file named exactly `.env.example` inside the session root that the session's Git
 * repository tracks is a committed template, not a secret. Untracked, ignored, symlinked, outside-root, or
 * differently named `.env*` files stay protected. Runs `git ls-files` from the session root with fsmonitor and
 * bare-repository discovery disabled, so a nested repository's config cannot run commands.
 */
export function isTrackedEnvTemplate(path: string, sessionRoot: string): boolean {
  try {
    const root = realpathSync.native(sessionRoot);
    const real = realpathSync.native(path);
    if (basename(real) !== ENV_TEMPLATE_NAME || !isWithin(root, real)
      || isProtectedSecretPath(dirname(real)) || !lstatSync(real).isFile()) return false;
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
    execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "safe.bareRepository=explicit",
      "ls-files", "--error-unmatch", "--", relative(root, real)], { cwd: root, stdio: "ignore", env });
    return true;
  } catch {
    return false;
  }
}

function gitFilePointer(dotGit: string): string | undefined {
  const match = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, "utf8"));
  return match ? realpathSync.native(resolve(dirname(dotGit), match[1]!.trim())) : undefined;
}

/** Whether `<worktree>/.git` is a file naming `record`, and `record/gitdir` names that file back. */
function linksBack(worktree: string, record: string): boolean {
  const dotGit = join(worktree, ".git");
  if (!lstatSync(dotGit).isFile() || gitFilePointer(dotGit) !== record) return false;
  const backLink = readFileSync(join(record, "gitdir"), "utf8").trim();
  return realpathSync.native(resolve(record, backLink)) === realpathSync.native(dotGit);
}

/**
 * Real paths of the other worktrees (including the main checkout) of the session root's Git repository. Read
 * from the repository's own metadata, not `git worktree list`: a linked worktree counts only when its `.git` file
 * and its `<common-dir>/worktrees/<id>/gitdir` record name each other, and the session root must link back the same
 * way, so a forged record cannot make another repository look like a sibling without writing inside it. Worktrees
 * that contain the home directory or the session root are dropped.
 */
export function sameRepositoryWorktrees(sessionRoot: string, home = homedir()): string[] {
  try {
    const root = realpathSync.native(sessionRoot);
    const realHome = existsSync(home) ? realpathSync.native(home) : resolve(home);
    const rootGit = join(root, ".git");
    let commonDir: string;
    if (lstatSync(rootGit).isDirectory()) {
      commonDir = realpathSync.native(rootGit);
    } else {
      const record = gitFilePointer(rootGit);
      if (!record || basename(dirname(record)) !== "worktrees" || !linksBack(root, record)) return [];
      commonDir = dirname(dirname(record));
    }
    const worktrees: string[] = [];
    const main = dirname(commonDir);
    if (basename(commonDir) === ".git") worktrees.push(main);
    const records = join(commonDir, "worktrees");
    for (const id of existsSync(records) ? readdirSync(records) : []) {
      try {
        const record = join(records, id);
        const worktree = dirname(resolve(record, readFileSync(join(record, "gitdir"), "utf8").trim()));
        if (linksBack(worktree, realpathSync.native(record))) worktrees.push(realpathSync.native(worktree));
      } catch {
        // A pruned or unreadable worktree record grants nothing.
      }
    }
    return worktrees.filter((path) => path !== root && !isWithin(path, realHome) && !isWithin(path, root));
  } catch {
    return [];
  }
}

const INSPECTION_PROGRAMS = new Set(["cat", "head", "tail", "grep", "rg", "ls", "wc", "find", "sed", "cd", "nl", "cut", "tr", "jq"]);
const WRITING_FIND_ACTIONS = /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/;
const SHELL_WORD = /'([^']*)'|"((?:\\.|[^"\\])*)"|(\S+)/g;

/**
 * Whether every command in a Bash line only reads files: listed inspection programs, no substitutions, no output
 * redirection other than to `/dev/null` or another descriptor, no in-place or file-writing options. Used to let
 * agents inspect trusted read-only trees, such as the installed Pi docs, with ordinary shell tools.
 */
export function isReadOnlyInspectionCommand(command: string): boolean {
  if (/\$\(|`|[<>]\(/.test(command)) return false;
  const withoutHarmlessRedirects = command.replace(/\d*>&\d/g, " ").replace(/\d*>\s*\/dev\/null(?=\s|$|[;&|])/g, " ");
  if (/>/.test(withoutHarmlessRedirects.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, ""))) return false;
  return shellSegments(withoutHarmlessRedirects).every(({ text: segment }) => {
    const words = [...segment.matchAll(SHELL_WORD)].map(([, single, double, bare]) => single ?? double ?? bare ?? "");
    const [program, ...args] = words;
    if (program === undefined) return true;
    if (!INSPECTION_PROGRAMS.has(program)) return false;
    if (program === "find") return !args.some((arg) => WRITING_FIND_ACTIONS.test(arg));
    if (program === "rg") return !args.some((arg) => /^--pre(?:=|$)/.test(arg));
    if (program === "sed") {
      // Only print-only flags and `-e` scripts: `-i`/`-I` edit in place, `-f` reads an uninspected script.
      const scripts: string[] = [];
      const operands: string[] = [];
      for (let index = 0; index < args.length; index += 1) {
        const arg = args[index]!;
        if (arg === "-e") scripts.push(args[++index] ?? "");
        else if (arg.startsWith("-")) {
          if (!/^-[nEr]+$/.test(arg)) return false;
        } else operands.push(arg);
      }
      const programs = scripts.length ? scripts : operands.slice(0, 1);
      return programs.length > 0 && programs.every(isSideEffectFreeSedProgram);
    }
    return true;
  });
}

/** Protected secret path, after the tracked `.env.example` exception; `path` must be absolute. */
export function isProtectedSecretTarget(path: string, sessionRoot: string): boolean {
  return isProtectedSecretPath(path) && !isTrackedEnvTemplate(path, sessionRoot);
}

function isProjectInstructionPath(path: string): boolean {
  const basename = normalize(path).split(sep).at(-1) ?? "";
  return /^(?:AGENTS(?:\.override)?|CLAUDE)\.md$/.test(basename);
}

function isProjectControlPath(path: string): boolean {
  const normalized = normalize(path);
  const segments = normalized.split(sep);
  if (isProjectInstructionPath(path)) return true;
  if (segments.includes(".pi") || segments.includes(".agents")) return true;

  const agentIndex = segments.lastIndexOf(".agent");
  if (agentIndex !== -1 && ["verify.sh", "diagnostics.sh"].includes(segments[agentIndex + 1] ?? "")) return true;

  const gitIndex = segments.lastIndexOf(".git");
  return gitIndex !== -1 && (segments[gitIndex + 1] === "config" || segments[gitIndex + 1] === "hooks");
}

function isRootVerifierScript(sessionRoot: string, targetPath: string): boolean {
  if (!isWithin(sessionRoot, targetPath)) return false;
  const pathFromRoot = relative(sessionRoot, targetPath);
  return pathFromRoot === join(".agent", "verify.sh") || pathFromRoot === join(".agent", "diagnostics.sh");
}

/** Allows staging and marking the verifier executable without allowing Bash to run it directly. */
export function permitsRootVerifierScriptBashReference(command: string, root: string, script: string): boolean {
  if (/[\r\n$`<>|;&()*?\[\]{}\\!]/.test(command)) return false;

  const trimmed = command.trim();
  if (/^git add(?:\s+--)?(?:\s+[^\s]+)+$/.test(trimmed)) return true;

  const chmod = /^chmod\s+(?:[ugoa]*\+x)\s+(.+)$/.exec(trimmed);
  if (!chmod) return false;
  const operand = chmod[1];
  const unquoted = (operand.startsWith('"') && operand.endsWith('"')) || (operand.startsWith("'") && operand.endsWith("'"))
    ? operand.slice(1, -1)
    : operand;
  return resolve(root, unquoted) === script;
}

export function isControlPlaneWriteBlocked(
  sessionRoot: string,
  targetPath: string,
  codingHarnessRoot: string,
  pluginWorkspaceRoot: string,
  sessionTempDirectory?: string,
): boolean {
  if (isWithin(codingHarnessRoot, sessionRoot)) return false;
  // Staged copies of project instructions in the private session workspace, as in the session root.
  if (sessionTempDirectory && isProjectInstructionPath(targetPath) && isWithin(sessionTempDirectory, targetPath)) return false;
  if (isWithin(pluginWorkspaceRoot, sessionRoot) && isWithin(pluginWorkspaceRoot, targetPath)) return false;
  if (isWithin(pluginWorkspaceRoot, targetPath)) return true;
  if (isProjectInstructionPath(targetPath) && isWithin(sessionRoot, targetPath)) return false;
  if (isRootVerifierScript(sessionRoot, targetPath)) return false;
  return isProjectControlPath(targetPath);
}

/** Playwright's managed browser cache, which read tools may inspect without prompting. */
export function playwrightBrowsersRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  const configured = env.PLAYWRIGHT_BROWSERS_PATH;
  if (configured && isAbsolute(configured)) return resolve(configured);
  return platform === "darwin"
    ? join(home, "Library", "Caches", "ms-playwright")
    : join(home, ".cache", "ms-playwright");
}

const INLINE_EVAL_BODY =
  /(?:^|[\s;|&(])(?:\S*\/)?(?:node|bun|deno|python|python3|perl|ruby)(?:\s+-{1,2}[\w-]+(?:=\S+)?)*\s+(?:-e|--eval|-c|-p|--print)\s+("(?:\\.|[^"\\])*"|'[^']*')/g;

/**
 * Inline interpreter code is not a list of filesystem arguments: quoted fragments such as a
 * concatenated `'/name.png'` are literals, not paths. Lexical extraction there produces false
 * denials without adding protection, since the equivalent script file is never inspected.
 */
function stripInlineEvalBodies(command: string): string {
  return command.replace(INLINE_EVAL_BODY, (match, body: string) => match.slice(0, match.length - body.length));
}

/** String literals inside inline interpreter code, which are still checked against secret paths. */
function inlineEvalStringLiterals(command: string): string[] {
  return [...command.matchAll(INLINE_EVAL_BODY)].flatMap(([, body]) =>
    [...body.slice(1, -1).matchAll(/'([^']*)'|"((?:\\.|[^"\\])*)"/g)].map(([, single, double]) => single ?? double));
}

function searchCommandIndex(tokens: string[]): number {
  return tokens.findIndex((token) => /(?:^|\/)(?:rg|grep)$/.test(token));
}

function ignoredSearchArgumentIndexes(tokens: string[]): Set<number> {
  const commandIndex = searchCommandIndex(tokens);
  if (commandIndex === -1) return new Set();

  const ignored = new Set<number>();
  const metadataOptions = new Set(["-g", "--glob", "--iglob", "--include", "--exclude", "--exclude-dir", "--include-dir", "-t", "-T", "--type", "--type-not"]);
  const patternOptions = new Set(["-e", "--regexp"]);
  let hasPattern = false;
  let filesOnly = false;

  for (let index = commandIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (metadataOptions.has(token)) {
      ignored.add(index + 1);
      index += 1;
      continue;
    }
    if (patternOptions.has(token)) {
      ignored.add(index + 1);
      hasPattern = true;
      index += 1;
      continue;
    }
    if (/^-e.+/.test(token) || token.startsWith("--regexp=")) {
      hasPattern = true;
      continue;
    }
    if (token === "--files") {
      filesOnly = true;
      continue;
    }
    if (token.startsWith("-")) continue;
    if (!filesOnly && !hasPattern) {
      ignored.add(index);
      hasPattern = true;
    }
  }
  return ignored;
}

function attachedSearchFileOptionValue(token: string): string | undefined {
  return /^(?:-f|--file=|--ignore-file=|--exclude-from=)(.+)$/.exec(token)?.[1];
}

function searchFileOptionValues(tokens: string[]): string[] {
  if (searchCommandIndex(tokens) === -1) return [];

  const values: string[] = [];
  const fileOptions = new Set(["-f", "--file", "--ignore-file", "--exclude-from"]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (fileOptions.has(token)) {
      const value = tokens[index + 1];
      if (value) values.push(value);
      index += 1;
      continue;
    }
    const attachedValue = attachedSearchFileOptionValue(token);
    if (attachedValue) values.push(attachedValue);
  }
  return values;
}

/**
 * Paths a Bash command may touch. With a directory context, relative candidates after a literal `cd` are returned
 * once per absolute directory they may run in (see `shellSegments`), and `cd` targets expanded from known
 * variables are included; without one, relative candidates are returned as written.
 */
export function shellPathCandidates(command: string, context?: ShellDirectoryContext): string[] {
  const { command: pathText, literals } = maskNonPathText(stripInlineEvalBodies(command), isDotEnvProbeOperand);
  const looksLikePath = (token: string) => {
    const unprefixed = token.startsWith("@") ? token.slice(1) : token;
    if (unprefixed === POSIX_NULL_DEVICE) return false;

    const isRelativeControlPath = /(?:^|\/)(?:AGENTS(?:\.override)?|CLAUDE)\.md$/.test(unprefixed)
      || /(?:^|\/)(?:\.pi|\.agents)(?:\/|$)/.test(unprefixed)
      || /(?:^|\/)\.agent\/(?:verify|diagnostics)\.sh$/.test(unprefixed)
      || /(?:^|\/)\.git\/(?:config|hooks)(?:\/|$)/.test(unprefixed);
    return unprefixed === ".." || unprefixed.startsWith("../") || unprefixed.startsWith("./") || unprefixed.startsWith("/") || unprefixed === "~" || unprefixed.startsWith("~/") || isRelativeControlPath;
  };
  const isSystemCommand = (token: string) => /^\/(?:bin|sbin|usr\/(?:bin|sbin|local\/bin)|opt\/homebrew\/(?:bin|sbin))\//.test(token);

  const literalSecrets = literalSecretCandidates(literals).filter(isProtectedSecretPath);
  return [...shellSegments(pathText, context).flatMap(({ text: segment, directories, targets }) => {
    const tokens = segment
      .replace(/'[^']*'/g, (value) => value.slice(1, -1))
      .replace(/"(?:\\.|[^"\\])*"/g, (value) => value.slice(1, -1))
      .split(/\s+/)
      .map((token) => token.replace(/^[([{;,]+|[)\]},;&]+$/g, ""));
    const isBracketTest = /^\s*(?:if\s+)?(?:\[\[|\[)(?:\s|$)/.test(segment);
    const ignoredSearchArguments = ignoredSearchArgumentIndexes(tokens);
    const positionalPaths = tokens.filter((token, index) => {
      if (!token || ignoredSearchArguments.has(index) || attachedSearchFileOptionValue(token)) return false;
      if (index === 0 && isSystemCommand(token)) return false;
      const isRootComparisonValue = isBracketTest
        && token === "/"
        && ["=", "==", "!=", "=~"].some((operator) => operator === tokens[index - 1] || operator === tokens[index + 1]);
      return !isRootComparisonValue && (looksLikePath(token) || isProtectedSecretPath(token));
    });
    const candidates = [...positionalPaths, ...searchFileOptionValues(tokens).filter((token) => looksLikePath(token) || isProtectedSecretPath(token))];
    const rebase = (candidate: string) => {
      const path = candidate.replace(/^@/, "");
      if (!directories || isAbsolute(path) || path === "~" || path.startsWith("~/")) return [candidate];
      return directories.map((directory) => join(directory, path));
    };
    return [...targets, ...candidates.flatMap(rebase)];
  }), ...literalSecrets];
}

function maskSingleQuotedStrings(command: string): string {
  const revealedCommandWords = command
    .replace(/(^\s*|[;|&()]\s*)'(sudo|\/(?:usr\/bin|bin)\/sudo)'(?=\s|$)/g, "$1$2")
    .replace(/(\|\s*)'(sh|bash|zsh|\/(?:usr\/)?bin\/(?:sh|bash|zsh))'(?=\s|$)/g, "$1$2")
    .replace(/(^\s*|[;|&()]\s*)'git'(?=\s|$)/g, "$1git")
    .replace(/((?:^\s*|[;|&()])\s*git(?:\s+[^;|&\s]+)*\s+)'(push|reset|filter-branch|filter-repo|clean|config|var)'(?=\s|$)/g, "$1$2")
    .replace(/((?:^\s*|[;|&()])\s*git\b[^;|&]*)'(--force|--hard|-[A-Za-z]*f[A-Za-z]*)'(?=\s|$)/g, "$1$2");
  return revealedCommandWords.replace(/'[^']*'/g, "__SINGLE_QUOTED__");
}

function commandMatches(command: string, pattern: RegExp): boolean {
  return pattern.test(maskSingleQuotedStrings(command));
}

function isWithinDirectory(root: string, target: string): boolean {
  const distance = relative(root, target);
  return distance === "" || (distance !== ".." && !distance.startsWith(`..${sep}`) && !isAbsolute(distance));
}

function removesOutsideWorkspace(command: string, cwd: string, home: string, sessionTempDirectory?: string): boolean {
  const masked = maskSingleQuotedStrings(command);
  const matches = masked.matchAll(/(?:^|[^A-Za-z0-9_-])(?:\/[\w./-]+\/)?(?:rm|rmdir)\s+([^;|&\n]*)/g);

  for (const match of matches) {
    for (const token of match[1].trim().split(/\s+/)) {
      if (!token || token === "--" || token.startsWith("-") || token === "{}" || token.includes("$") || token === "__SINGLE_QUOTED__") continue;
      if (token.startsWith("~") && token !== "~" && !token.startsWith("~/")) return true;
      const target = token === "~" || token.startsWith("~/")
        ? resolve(home, token.slice(2))
        : resolve(cwd, token);
      if (!isWithinDirectory(cwd, target)
        && !isWithinDirectory("/tmp", target)
        && !isWithinDirectory("/private/tmp", target)
        && !(sessionTempDirectory && isWithinDirectory(sessionTempDirectory, target))) return true;
    }
  }
  return false;
}

/** Message text is usually quoted, so this inspects the unmasked command. */
function publishesAgentAttribution(command: string): boolean {
  const writesMessage = /\bgit(?:\s+[^;|&\s]+)*\s+(?:commit|commit-tree|merge|tag|notes)(?=\s|$)/.test(command)
    || /(?:^|[^A-Za-z0-9_-])gh\s+(?:pr|issue|release|api)\b/.test(command);
  return writesMessage && /co-authored-by[:=]|claude-session:|claude\.ai\/code\/session_/i.test(command);
}

/** Returns the hard-deny reason for a Bash command, if the shared safety policy blocks it. */
export function deniedBashCommandReason(
  command: string,
  cwd = process.cwd(),
  home = homedir(),
  sessionTempDirectory?: string,
): string | undefined {
  const masked = maskSingleQuotedStrings(command);

  const secretCandidates = [...shellPathCandidates(masked), ...inlineEvalStringLiterals(command)];
  const absolute = (candidate: string) => candidate === "~" || candidate.startsWith("~/")
    ? join(home, candidate.slice(1))
    : resolve(cwd, candidate.replace(/^@/, ""));
  if (secretCandidates.some((candidate) => isProtectedSecretPath(candidate) && !isTrackedEnvTemplate(absolute(candidate), cwd))) {
    return "touches a protected secret path";
  }
  if (commandMatches(command, /(^|[^A-Za-z0-9_-])(?:sudo|\/(?:usr\/bin|bin)\/sudo)(?=\s|$)/)) {
    return "`sudo` is never run by Pi";
  }
  if (/\|\s*(?:(?:sudo|\/(?:usr\/bin|bin)\/sudo)\s+)?(?:\/(?:usr\/)?bin\/)?(?:sh|bash|zsh)\b/.test(masked)) {
    return "pipe-to-shell executes unreviewed code";
  }
  if (/(^|[^A-Za-z0-9_-])(?:\/(?:usr\/)?bin\/)?(?:sh|bash|zsh)\s+(?:-[A-Za-z]*c[A-Za-z]*|--command)(?=\s|$)/.test(command)) {
    return "nested shell command strings bypass command safety inspection";
  }
  if (commandMatches(command, /\bgit(?:\s+[^;|&\s]+)*\s+push\b[^;|&]*(?:\s--force|\s-[A-Za-z]*f[A-Za-z]*)(?=\s|$)/)
    || commandMatches(command, /\bgit(?:\s+[^;|&\s]+)*\s+push\b[^;|&]*\s\+\S+:\S+/)) {
    return "`git push --force` is blocked; use `--force-with-lease` instead";
  }
  if (commandMatches(command, /\bgit(?:\s+[^;|&\s]+)*\s+reset\b[^;|&]*\s--hard(?=\s|$)/)) {
    return "`git reset --hard` discards work irrecoverably";
  }
  if (commandMatches(command, /\bgit(?:\s+[^;|&\s]+)*\s+config\b[^;|&]*(?:\buser\.(?:name|email)\b|--(?:list|name-only|get-regexp)\b|-l\b)/)
    || commandMatches(command, /\bgit(?:\s+[^;|&\s]+)*\s+var\s+GIT_(?:AUTHOR|COMMITTER)_IDENT\b/)) {
    return "Git author identity queries are blocked";
  }
  if (publishesAgentAttribution(command)) {
    return "Co-Authored-By trailers and Claude session links are blocked in commits and GitHub text";
  }
  if (commandMatches(command, /\bgit(?:\s+[^;|&\s]+)*\s+(?:filter-branch|filter-repo)\b/)) return "Git history rewrites are blocked";
  if (commandMatches(command, /\bgit(?:\s+[^;|&\s]+)*\s+clean\b[^;|&]*\s-[^\s;|&]*f/)) return "`git clean -f` deletes untracked files irrecoverably";
  if (commandMatches(command, /\bchmod(?:\s+-\S+)*\s+(?:0)?777(?=\s|$)/)) return "`chmod 777` makes files world-writable";
  if (removesOutsideWorkspace(command, cwd, home, sessionTempDirectory)) return "`rm` outside the workspace or temporary directory is blocked";
  return undefined;
}
