import { homedir } from "node:os";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

const SECRET_PATTERNS = [
  /(^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|\.aws(?:\/|$)|\.gnupg(?:\/|$)|\.azure(?:\/|$)|\.kube(?:\/|$)|\.gcloud(?:\/|$))/,
  /(^|\/)(?:credentials\.json|service-account[^/]*\.json|id_rsa|id_ed25519|\.netrc|\.npmrc|\.pypirc)$/,
  /(^|\/)\.config\/gcloud(?:\/|$)/,
  /(^|\/)Library\/Keychains(?:\/|$)/,
  /(^|\/)\.docker\/config\.json$/,
  /\.(?:pem|key)$/,
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

function isProjectControlPath(path: string): boolean {
  const normalized = normalize(path);
  const segments = normalized.split(sep);
  const basename = segments.at(-1) ?? "";
  if (/^(?:AGENTS(?:\.override)?|CLAUDE)\.md$/.test(basename)) return true;
  if (segments.includes(".pi") || segments.includes(".agents")) return true;

  const agentIndex = segments.lastIndexOf(".agent");
  if (agentIndex !== -1 && segments[agentIndex + 1] === "verify.sh") return true;

  const gitIndex = segments.lastIndexOf(".git");
  return gitIndex !== -1 && (segments[gitIndex + 1] === "config" || segments[gitIndex + 1] === "hooks");
}

export function isControlPlaneWriteBlocked(
  sessionRoot: string,
  targetPath: string,
  codingHarnessRoot: string,
  pluginWorkspaceRoot: string,
): boolean {
  if (isWithin(codingHarnessRoot, sessionRoot)) return false;
  return isWithin(pluginWorkspaceRoot, targetPath) || isProjectControlPath(targetPath);
}

export function shellPathCandidates(command: string): string[] {
  const segments = command.split(/&&|\|\||[;|]/);
  const looksLikePath = (token: string) => {
    const unprefixed = token.startsWith("@") ? token.slice(1) : token;
    const isRelativeControlPath = /(?:^|\/)(?:AGENTS(?:\.override)?|CLAUDE)\.md$/.test(unprefixed)
      || /(?:^|\/)(?:\.pi|\.agents)(?:\/|$)/.test(unprefixed)
      || /(?:^|\/)\.agent\/verify\.sh$/.test(unprefixed)
      || /(?:^|\/)\.git\/(?:config|hooks)(?:\/|$)/.test(unprefixed);
    return unprefixed === ".." || unprefixed.startsWith("../") || unprefixed.startsWith("./") || unprefixed.startsWith("/") || unprefixed === "~" || unprefixed.startsWith("~/") || isRelativeControlPath;
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
      return looksLikePath(token) || isProtectedSecretPath(token);
    });
  });
}

function maskSingleQuotedStrings(command: string): string {
  return command.replace(/'[^']*'/g, "__SINGLE_QUOTED__");
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
  const matches = masked.matchAll(/(?:^|[^A-Za-z0-9_-])(?:\/[\w./-]+\/)?(?:rm|rmdir)\s+([^;|&]*)/g);

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

/** Returns the hard-deny reason for a Bash command, if the shared safety policy blocks it. */
export function deniedBashCommandReason(
  command: string,
  cwd = process.cwd(),
  home = homedir(),
  sessionTempDirectory?: string,
): string | undefined {
  const masked = maskSingleQuotedStrings(command);

  if (shellPathCandidates(masked).some(isProtectedSecretPath)) return "touches a protected secret path";
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
  if (commandMatches(command, /\bgit(?:\s+[^;|&\s]+)*\s+(?:filter-branch|filter-repo)\b/)) return "Git history rewrites are blocked";
  if (commandMatches(command, /\bgit(?:\s+[^;|&\s]+)*\s+clean\b[^;|&]*\s-[^\s;|&]*f/)) return "`git clean -f` deletes untracked files irrecoverably";
  if (commandMatches(command, /\bchmod(?:\s+-\S+)*\s+(?:0)?777(?=\s|$)/)) return "`chmod 777` makes files world-writable";
  if (removesOutsideWorkspace(command, cwd, home, sessionTempDirectory)) return "`rm` outside the workspace or temporary directory is blocked";
  return undefined;
}
