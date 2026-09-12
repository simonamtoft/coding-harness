import { isAbsolute, join } from "node:path";
import { isWithin } from "./policy.ts";

export function changesDirectoryToSessionTemp(
  command: string,
  sessionTempDirectory: string,
  resolvePath: (path: string) => string,
): boolean {
  const logicalCommand = command.replace(/\\\r?\n/g, "");
  return logicalCommand.split(/&&|\|\||[;|\r\n]/).some((segment) => {
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
    return isAbsolute(expanded) && isWithin(sessionTempDirectory, resolvePath(expanded));
  });
}
