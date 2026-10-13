const REMOTE_SHELL_PROGRAMS = new Set(["ssh", "scp", "sftp", "sshfs", "ssh-copy-id"]);
const SHELL_KEYWORDS = new Set(["if", "elif", "while", "until", "do", "then", "else", "!", "{"]);
// Wrappers take options with separate values, so every later token is a possible command word.
const COMMAND_WRAPPERS = new Set(["env", "command", "exec", "eval", "nohup", "time", "nice", "timeout", "xargs", "sudo", "doas"]);
const FIND_EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const RSYNC_REMOTE_OPERAND = /^(?:[^\s@/:]+@)?[^\s/:]+:(?!:)/;
const GIT_CUSTOM_SSH = /\bGIT_SSH(?:_COMMAND)?=|\bcore\.sshCommand\b/i;

function commandWord(token: string): string {
  return token.split("/").at(-1) ?? "";
}

function usesRemoteRsync(args: string[]): boolean {
  return args.some((arg) => /^--rsh(?:=|$)/.test(arg)
    || (/^-[A-Za-z]*e/.test(arg) && !arg.startsWith("--"))
    || (!arg.startsWith("-") && RSYNC_REMOTE_OPERAND.test(arg)));
}

function segmentRemoteProgram(tokens: string[]): string | undefined {
  let index = 0;
  while (index < tokens.length && (tokens[index]!.includes("=") || SHELL_KEYWORDS.has(tokens[index]!))) index += 1;

  const commandPositions = COMMAND_WRAPPERS.has(commandWord(tokens[index] ?? ""))
    ? tokens.map((_, position) => position).slice(index + 1)
    : [index, ...tokens.flatMap((token, position) => FIND_EXEC_FLAGS.has(token) ? [position + 1] : [])];
  for (const position of commandPositions) {
    const word = commandWord(tokens[position] ?? "");
    if (REMOTE_SHELL_PROGRAMS.has(word)) return word;
    if (word === "rsync" && usesRemoteRsync(tokens.slice(position + 1))) return "rsync";
  }
  return undefined;
}

/**
 * Names the SSH-family program a Bash command visibly invokes, if any.
 * Lexical only: SSH started from scripts, aliases, or Git's default transport is not detected.
 */
export function remoteShellProgram(command: string): string | undefined {
  if (GIT_CUSTOM_SSH.test(command)) return "git with a custom SSH command";

  for (const segment of command.split(/\$\(|[;&|()`\n]/)) {
    const tokens = segment.trim().split(/\s+/).map((token) => token.replace(/['"\\]/g, "")).filter(Boolean);
    const program = segmentRemoteProgram(tokens);
    if (program) return program;
  }
  return undefined;
}

export async function requestRemoteShellConfirmation(
  ctx: { hasUI: boolean; ui: { select: (title: string, options: string[]) => Promise<string | undefined> } },
  program: string,
  command: string,
): Promise<boolean> {
  if (!ctx.hasUI) return false;
  const choice = await ctx.ui.select(
    `Allow SSH-family command?\nProgram: ${program}\nCommand: ${command}`,
    ["Allow once", "Deny"],
  );
  return choice === "Allow once";
}
