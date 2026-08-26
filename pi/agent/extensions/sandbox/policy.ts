import { isAbsolute, normalize, relative, sep } from "node:path";

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

export function shellPathCandidates(command: string): string[] {
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
      return looksLikePath(token) || isProtectedSecretPath(token);
    });
  });
}
