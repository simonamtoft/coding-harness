const EXPLICIT_VARIABLES_ENV = "PI_PROTECTED_ENV_VARS";
const SECRET_LIKE_NAME = /(?:^|_)(?:API_KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|PRIVATE_KEY)(?:_|$)/i;
const MINIMUM_VALUE_LENGTH = 8;

export const BLOCKED_RESULT_TEXT = "Tool result blocked because it contained a protected environment value.";

function explicitlyProtectedNames(env: NodeJS.ProcessEnv): Set<string> {
  return new Set((env[EXPLICIT_VARIABLES_ENV] ?? "").split(",").map((name) => name.trim()).filter(Boolean));
}

export function protectedEnvironmentValues(env: NodeJS.ProcessEnv): string[] {
  const explicitNames = explicitlyProtectedNames(env);
  const values = Object.entries(env)
    .filter(([name, value]) => {
      if (name === EXPLICIT_VARIABLES_ENV || typeof value !== "string" || value.length === 0) return false;
      if (explicitNames.has(name)) return true;
      return SECRET_LIKE_NAME.test(name) && value.length >= MINIMUM_VALUE_LENGTH;
    })
    .map(([, value]) => value!);

  return [...new Set(values)];
}

function stringsIn(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];

  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((item) => stringsIn(item, seen));
  return Object.values(value).flatMap((item) => stringsIn(item, seen));
}

export function sanitizeToolResult(
  content: readonly unknown[],
  details: unknown,
  protectedValues: readonly string[],
): { content: Array<{ type: "text"; text: string }>; details: { blocked: true; reason: string }; isError: true } | undefined {
  if (protectedValues.length === 0) return undefined;

  const resultStrings = [...stringsIn(content), ...stringsIn(details)];
  if (!protectedValues.some((secret) => resultStrings.some((text) => text.includes(secret)))) return undefined;

  return {
    content: [{ type: "text", text: BLOCKED_RESULT_TEXT }],
    details: { blocked: true, reason: "protected-environment-value" },
    isError: true,
  };
}
