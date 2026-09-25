/**
 * Redaction and secret scanning for releasing benchmark evidence. Local records stay unredacted;
 * only an export is redacted, and the export is scanned afterwards for anything that survived.
 */

export type RedactionContext = {
  /** Literal values of the runner's secret-looking environment variables. */
  secrets: string[];
  home: string;
  user: string;
  host: string;
};

/** Where a secret-like value was found; never the value or its neighbourhood, which may be sensitive too. */
export type SecretFinding = { kind: string; line: number };

// Underscore-delimited, so GIT_AUTHOR_NAME is not mistaken for an AUTH variable.
const SECRET_ENV_NAME = /(^|_)(KEY|KEYS|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIALS?)(_|$)/i;
const MIN_SECRET_LENGTH = 8;

/** Values of environment variables whose names mark them as secrets, longest first. */
export function secretEnvValues(env: Record<string, string | undefined>): string[] {
  const values = Object.entries(env).flatMap(([name, value]) =>
    (SECRET_ENV_NAME.test(name) && value !== undefined && value.length >= MIN_SECRET_LENGTH ? [value] : []));
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

/** Known credential formats. Each is replaced by `[REDACTED:<kind>]`. */
const TOKEN_PATTERNS: { kind: string; pattern: RegExp }[] = [
  { kind: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  // The word boundary keeps ordinary words such as `task-...` from matching.
  { kind: "openai-key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { kind: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi },
];

/**
 * Assignments that look like credentials but match no known format; reported, never rewritten. The
 * name may carry underscore- or hyphen-delimited parts (`DB_PASSWORD`, `aws_secret_access_key`) but
 * not run into other letters, so `tokenizer: ...` does not match.
 */
const SUSPICIOUS_ASSIGNMENT =
  /(?<![A-Za-z0-9_])(?:[A-Za-z0-9]+[_-])*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)(?:[_-][A-Za-z0-9]+)*["']?\s*[:=]\s*["']?[^\s"',;]{8,}/gi;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identityPatterns(context: RedactionContext): { kind: string; pattern: RegExp; replacement: string }[] {
  const patterns = [{ kind: "home", pattern: new RegExp(escapeRegExp(context.home), "g"), replacement: "~" }];
  if (context.user.length >= 3) patterns.push({ kind: "user", pattern: new RegExp(`\\b${escapeRegExp(context.user)}\\b`, "g"), replacement: "[user]" });
  if (context.host.length >= 3) patterns.push({ kind: "host", pattern: new RegExp(`\\b${escapeRegExp(context.host)}\\b`, "g"), replacement: "[host]" });
  return patterns;
}

/** Replaces secret values, credential formats, the home directory, username, and hostname. */
export function redact(text: string, context: RedactionContext): string {
  let result = text;
  for (const secret of context.secrets) result = result.split(secret).join("[REDACTED:env]");
  for (const { kind, pattern } of TOKEN_PATTERNS) result = result.replace(pattern, `[REDACTED:${kind}]`);
  for (const { pattern, replacement } of identityPatterns(context)) result = result.replace(pattern, replacement);
  return result;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Everything secret-like in already-redacted text: anything redaction missed plus suspicious assignments. */
export function scanForSecrets(text: string, context: RedactionContext): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const secret of context.secrets) {
    const index = text.indexOf(secret);
    if (index >= 0) findings.push({ kind: "env-secret", line: lineAt(text, index) });
  }
  const patterns = [
    ...TOKEN_PATTERNS,
    ...identityPatterns(context).map(({ kind, pattern }) => ({ kind, pattern })),
    { kind: "suspicious-assignment", pattern: SUSPICIOUS_ASSIGNMENT },
  ];
  for (const { kind, pattern } of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      findings.push({ kind, line: lineAt(text, match.index ?? 0) });
    }
  }
  return findings;
}

function redactValue(value: unknown, context: RedactionContext): unknown {
  if (typeof value === "string") return redact(value, context);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, context));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [redact(key, context), redactValue(entry, context)]));
  }
  return value;
}

/**
 * Applies `redact` to every string in a JSON value, keys included. The shape is preserved (strings
 * stay strings), except that a redacted key can differ from the declared one, so treat the result
 * as data to serialize rather than as a typed domain value.
 */
export function redactJson<T>(value: T, context: RedactionContext): T {
  return redactValue(value, context) as T;
}
