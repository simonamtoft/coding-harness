const REMOTE_SHELL_PROGRAMS = new Set(["ssh", "scp", "sftp", "sshfs", "ssh-copy-id"]);
const TERRAFORM_PROGRAMS = new Set(["terraform", "tf", "tofu", "terragrunt"]);
// The first of these words names the subcommand, so flag values and Terragrunt's `run`/`run-all` are skipped.
const TERRAFORM_SUBCOMMANDS = new Set([
  "apply", "console", "destroy", "fmt", "force-unlock", "get", "graph", "import", "init", "login", "logout",
  "metadata", "output", "plan", "providers", "refresh", "show", "state", "taint", "test", "untaint",
  "validate", "version", "workspace",
  // Terragrunt's legacy multi-module forms.
  "apply-all", "destroy-all", "output-all", "plan-all", "validate-all",
]);
const TERRAFORM_STATE_CHANGING_SUBCOMMANDS = new Set([
  "apply", "destroy", "force-unlock", "import", "refresh", "taint", "test", "untaint",
  "apply-all", "destroy-all",
]);
const TERRAFORM_STATE_CHANGING_NESTED: Record<string, Set<string>> = {
  state: new Set(["mv", "push", "replace-provider", "rm"]),
  workspace: new Set(["delete", "new"]),
};
const SHELL_KEYWORDS = new Set(["if", "elif", "while", "until", "do", "then", "else", "!", "{"]);
// Options that consume the following token; the command word follows the wrapper's options and operands.
const WRAPPER_VALUE_OPTIONS: Record<string, Set<string>> = {
  env: new Set(["-u", "--unset", "-C", "--chdir"]),
  command: new Set(),
  exec: new Set(["-a"]),
  nohup: new Set(),
  time: new Set(["-f", "--format", "-o", "--output"]),
  nice: new Set(["-n", "--adjustment"]),
  timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
  xargs: new Set(["-I", "-L", "-n", "-P", "-s", "-E", "-d", "-a", "--max-args", "--max-procs", "--max-lines",
    "--max-chars", "--delimiter", "--arg-file", "--eof"]),
  sudo: new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-T", "-U", "--user", "--group", "--chdir"]),
  doas: new Set(["-u", "-C"]),
};
const SHELL_PROGRAMS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const FIND_EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const RSYNC_REMOTE_OPERAND = /^(?:[^\s@/:]+@)?[^\s/:]+:(?!:)/;
// Covers direct variables, `GIT_CONFIG_KEY_n=core.sshCommand`, `-c`, and `--config-env` settings.
const GIT_SSH_SETTING = /^GIT_SSH(?:_COMMAND)?=|core\.sshCommand/i;
const TF_CLI_ARGS = /TF_CLI_ARGS/;
// A redirection word as the lexer keeps it, e.g. `2>/dev/null`, `>>log`, `2>&1`, `&>out`, or a bare `>`; group 1 is its target.
const REDIRECTION = /^(?:\d+|&)?(?:<>|>>|>|<)&?(.*)$/;
const EXPORTING_BUILTINS = new Set(["export", "declare", "typeset", "readonly", "local"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WORD_BREAK = /[\s;&|<>()]/;

export type ConfirmedCommand = { category: "SSH-family" | "state-changing Terraform"; program: string };

const CUSTOM_GIT_SSH: ConfirmedCommand = { category: "SSH-family", program: "git with a custom SSH command" };

/** Index of the `)` closing a `$(` whose body starts at `start`, honouring quotes; the input length if unclosed. */
function closingParen(source: string, start: number): number {
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") index += 1;
    else if (char === "'" || char === "\"") index = closingQuote(source, index + 1, char);
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return index;
  }
  return source.length;
}

/** Index of the `quote` closing text that starts at `start`; the input length if unclosed. */
function closingQuote(source: string, start: number, quote: string, escapes = quote !== "'"): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\\" && escapes) index += 1;
    else if (source[index] === quote) return index;
  }
  return source.length;
}

/** Commands in the `$(…)` and backtick substitutions of text the shell expands but does not run. */
function substitutionCommands(text: string): string[][] {
  const commands: string[][] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
    } else if (text.startsWith("$(", index)) {
      const end = closingParen(text, index + 2);
      commands.push(...simpleCommands(text.slice(index + 2, end)));
      index = end;
    } else if (text[index] === "`") {
      const end = closingQuote(text, index + 1, "`");
      commands.push(...simpleCommands(text.slice(index + 1, end)));
      index = end;
    }
  }
  return commands;
}

/**
 * Splits shell source into simple commands of quote-removed words. Quoted text, comments, arithmetic, and
 * heredoc bodies stay data; `$(…)` and backtick substitutions, also inside double quotes and unquoted
 * heredocs, become their own commands. Heredocs fed to a shell, or never closed, are scanned as commands.
 */
function simpleCommands(source: string): string[][] {
  const commands: string[][] = [];
  const pendingHeredocs: Array<{ delimiter: string; stripTabs: boolean; quoted: boolean; feedsShell: boolean }> = [];
  let tokens: string[] = [];
  let word = "";
  let inWord = false;
  let index = 0;

  const append = (text: string) => { word += text; inWord = true; };
  const endWord = () => {
    if (inWord) tokens.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (tokens.length > 0) commands.push(tokens);
    tokens = [];
  };
  // Returns the index after the substitution starting at `index`, or undefined if none starts there.
  const substitution = (): number | undefined => {
    if (source.startsWith("$(", index)) {
      const end = closingParen(source, index + 2);
      commands.push(...simpleCommands(source.slice(index + 2, end)));
      return end + 1;
    }
    if (source[index] === "`") {
      const end = closingQuote(source, index + 1, "`");
      commands.push(...simpleCommands(source.slice(index + 1, end)));
      return end + 1;
    }
    return undefined;
  };
  const readDoubleQuoted = () => {
    inWord = true;
    while (index < source.length && source[index] !== "\"") {
      const afterSubstitution = substitution();
      if (afterSubstitution !== undefined) {
        index = afterSubstitution;
      } else if (source[index] === "\\" && /[$`"\\\n]/.test(source[index + 1] ?? "")) {
        if (source[index + 1] !== "\n") append(source[index + 1]!);
        index += 2;
      } else {
        append(source[index]!);
        index += 1;
      }
    }
    index += 1;
  };
  const readHeredocDelimiter = () => {
    const stripTabs = source[index] === "-";
    if (stripTabs) index += 1;
    while (source[index] === " " || source[index] === "\t") index += 1;
    let delimiter = "";
    let quoted = false;
    while (index < source.length && !WORD_BREAK.test(source[index]!)) {
      const char = source[index]!;
      if (char === "'" || char === "\"") {
        const end = closingQuote(source, index + 1, char);
        delimiter += source.slice(index + 1, end);
        quoted = true;
        index = end + 1;
      } else if (char === "\\") {
        delimiter += source[index + 1] ?? "";
        quoted = true;
        index += 2;
      } else {
        delimiter += char;
        index += 1;
      }
    }
    const feedsShell = tokens.some((token) => SHELL_PROGRAMS.has(commandWord(token)) || commandWord(token) === "eval");
    pendingHeredocs.push({ delimiter, stripTabs, quoted, feedsShell });
  };
  const readHeredocBodies = () => {
    for (const { delimiter, stripTabs, quoted, feedsShell } of pendingHeredocs.splice(0)) {
      const bodyStart = index;
      let closed = false;
      while (index < source.length && !closed) {
        const lineEnd = source.indexOf("\n", index) === -1 ? source.length : source.indexOf("\n", index);
        closed = (stripTabs ? source.slice(index, lineEnd).replace(/^\t+/, "") : source.slice(index, lineEnd)) === delimiter;
        index = lineEnd + 1;
      }
      const body = source.slice(bodyStart, index);
      if (feedsShell || !closed) commands.push(...simpleCommands(body));
      else if (!quoted) commands.push(...substitutionCommands(body));
    }
  };

  while (index < source.length) {
    const char = source[index]!;
    const afterSubstitution = substitution();
    if (afterSubstitution !== undefined) {
      inWord = true;
      index = afterSubstitution;
    } else if (char === "\\") {
      if (source[index + 1] !== "\n") append(source[index + 1] ?? "");
      index += 2;
    } else if (char === "'") {
      const end = closingQuote(source, index + 1, "'");
      append(source.slice(index + 1, end));
      index = end + 1;
    } else if (source.startsWith("$'", index)) {
      const end = closingQuote(source, index + 2, "'", true);
      append(source.slice(index + 2, end));
      index = end + 1;
    } else if (source.startsWith("((", index)) {
      endCommand();
      index = closingParen(source, index + 1) + 1;
    } else if (char === "\"") {
      index += 1;
      readDoubleQuoted();
    } else if (char === "#" && !inWord) {
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (source.startsWith("<<<", index)) {
      // A here-string: its word is ordinary shell text, scanned like any other.
      endWord();
      index += 3;
    } else if (source.startsWith("<<", index)) {
      endWord();
      index += 2;
      readHeredocDelimiter();
    } else if (char === "&" && (/[<>]$/.test(word) || source[index + 1] === ">")) {
      append(char);
      index += 1;
    } else if (char === "\n") {
      endCommand();
      index += 1;
      readHeredocBodies();
    } else if (";&|()".includes(char)) {
      endCommand();
      index += 1;
    } else if (/\s/.test(char)) {
      endWord();
      index += 1;
    } else {
      append(char);
      index += 1;
    }
  }
  endCommand();
  return commands;
}

function commandWord(token: string): string {
  return token.split("/").at(-1) ?? "";
}

function usesRemoteRsync(args: string[]): boolean {
  return args.some((arg) => /^--rsh(?:=|$)/.test(arg)
    || (/^-[A-Za-z]*e/.test(arg) && !arg.startsWith("--"))
    || (!arg.startsWith("-") && RSYNC_REMOTE_OPERAND.test(arg)));
}

/** Returns the state-changing subcommand, such as `apply` or `state rm`, if any. */
function terraformStateChangingSubcommand(args: string[], cliArgsInjected: boolean): string | undefined {
  const index = args.findIndex((arg) => TERRAFORM_SUBCOMMANDS.has(arg));
  const subcommand = args[index];
  if (subcommand === undefined) return undefined;
  if (subcommand === "init") return initIsLocalOnly(args.slice(index + 1), cliArgsInjected) ? undefined : "init";
  if (TERRAFORM_STATE_CHANGING_SUBCOMMANDS.has(subcommand)) return subcommand;

  const nested = args.slice(index + 1).find((arg) => !arg.startsWith("-"));
  return nested !== undefined && TERRAFORM_STATE_CHANGING_NESTED[subcommand]?.has(nested)
    ? `${subcommand} ${nested}`
    : undefined;
}

/**
 * `init` copies state between backends only through `-migrate-state`, `-force-copy`, or an answered
 * migration prompt. It is local-only when `-backend=false` is in effect, or when `-input=false` is in
 * effect, neither migration flag is, and no `TF_CLI_ARGS*` variable can append flags Terraform would
 * honour. The last occurrence of each flag wins, as in Terraform.
 */
function initIsLocalOnly(args: string[], cliArgsInjected: boolean): boolean {
  const lastValue = (flag: string) => args.filter((arg) => new RegExp(`^--?${flag}(?:=|$)`).test(arg)).at(-1);
  const isFalse = (value: string | undefined) => value !== undefined && /=(?:false|0)$/i.test(value);
  if (isFalse(lastValue("backend"))) return true;
  const migrates = ["migrate-state", "force-copy"].some((flag) => {
    const value = lastValue(flag);
    return value !== undefined && !isFalse(value);
  });
  return !cliArgsInjected && !migrates && isFalse(lastValue("input"));
}

/** Index of the wrapped command word after a wrapper's options, assignments, and operands. */
function wrappedCommandIndex(wrapper: string, tokens: string[], start: number): number {
  const valueOptions = WRAPPER_VALUE_OPTIONS[wrapper]!;
  let operands = wrapper === "timeout" ? 1 : 0;
  let optionsEnded = false;
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (!optionsEnded && token === "--") {
      optionsEnded = true;
      index += 1;
    } else if (!optionsEnded && token.startsWith("-") && token.length > 1) {
      index += valueOptions.has(token) ? 2 : 1;
    } else if (wrapper === "env" && ASSIGNMENT.test(token)) {
      index += 1;
    } else if (operands > 0) {
      operands -= 1;
      index += 1;
    } else {
      break;
    }
  }
  return index;
}

/** The command line `env -S`/`--split-string` runs, joined with any later arguments. */
function envSplitString(args: string[]): string | undefined {
  for (const [index, arg] of args.entries()) {
    const rest = args.slice(index + 1);
    if (arg === "-S" || arg === "--split-string") return rest.join(" ");
    if (/^-S./.test(arg)) return [arg.slice(2), ...rest].join(" ");
    if (arg.startsWith("--split-string=")) return [arg.slice("--split-string=".length), ...rest].join(" ");
    if (!arg.startsWith("-") && !ASSIGNMENT.test(arg)) return undefined;
  }
  return undefined;
}

/**
 * Names the confirmation-required program a Bash command invokes, if any.
 * Lexical only: programs started from scripts, aliases, variables, or Git's default transport are not detected.
 */
export function confirmedCommand(source: string): ConfirmedCommand | undefined {
  // Any mention counts: assignments, `export`, `env`, and nested shells can all reach Terraform's environment.
  return confirmedIn(source, TF_CLI_ARGS.test(source));
}

function confirmedIn(source: string, cliArgsInjected: boolean): ConfirmedCommand | undefined {
  for (const tokens of simpleCommands(source)) {
    const match = confirmedSimpleCommand(tokens, cliArgsInjected);
    if (match) return match;
  }
  return undefined;
}

function confirmedSimpleCommand(tokens: string[], cliArgsInjected: boolean): ConfirmedCommand | undefined {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    const redirection = REDIRECTION.exec(token);
    if (redirection) {
      // A bare operator such as `>` takes its target from the next word.
      index += redirection[1] ? 1 : 2;
      continue;
    }
    if (!ASSIGNMENT.test(token) && !SHELL_KEYWORDS.has(token)) break;
    if (GIT_SSH_SETTING.test(token)) return CUSTOM_GIT_SSH;
    index += 1;
  }
  return confirmedInvocation(tokens, index, cliArgsInjected);
}

function confirmedInvocation(tokens: string[], index: number, cliArgsInjected: boolean): ConfirmedCommand | undefined {
  const word = commandWord(tokens[index] ?? "");
  const args = tokens.slice(index + 1);

  if (WRAPPER_VALUE_OPTIONS[word]) {
    const wrappedIndex = wrappedCommandIndex(word, tokens, index + 1);
    const wrapperArgs = tokens.slice(index + 1, wrappedIndex);
    if (word === "command" && wrapperArgs.some((arg) => /^-[A-Za-z]*[vV]/.test(arg))) return undefined;
    if (word === "env") {
      if (wrapperArgs.some((arg) => GIT_SSH_SETTING.test(arg))) return CUSTOM_GIT_SSH;
      const splitString = envSplitString(tokens.slice(index + 1));
      if (splitString !== undefined) return confirmedIn(splitString, cliArgsInjected);
    }
    return confirmedInvocation(tokens, wrappedIndex, cliArgsInjected);
  }
  if (word === "eval") return confirmedIn(args.join(" "), cliArgsInjected);
  if (SHELL_PROGRAMS.has(word)) {
    const scriptFlag = args.findIndex((arg) => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg));
    return scriptFlag === -1 ? undefined : confirmedIn(args[scriptFlag + 1] ?? "", cliArgsInjected);
  }
  if ((EXPORTING_BUILTINS.has(word) || word === "git") && args.some((arg) => GIT_SSH_SETTING.test(arg))) {
    return CUSTOM_GIT_SSH;
  }
  if (REMOTE_SHELL_PROGRAMS.has(word)) return { category: "SSH-family", program: word };
  if (word === "rsync" && usesRemoteRsync(args)) return { category: "SSH-family", program: "rsync" };
  if (TERRAFORM_PROGRAMS.has(word)) {
    const subcommand = terraformStateChangingSubcommand(args, cliArgsInjected);
    return subcommand ? { category: "state-changing Terraform", program: `${word} ${subcommand}` } : undefined;
  }
  if (word === "find") {
    for (const [offset, arg] of args.entries()) {
      const match = FIND_EXEC_FLAGS.has(arg) ? confirmedInvocation(args, offset + 1, cliArgsInjected) : undefined;
      if (match) return match;
    }
  }
  return undefined;
}

/** Programs that read and refresh the Azure CLI token cache; Terraform's azurerm provider and backend call `az`. */
const AZURE_CREDENTIAL_PROGRAMS = new Set(["az", ...TERRAFORM_PROGRAMS]);

/**
 * Names the first program in a Bash command that needs the Azure CLI credentials, if any.
 * Lexical like `confirmedCommand`: a script that calls `az` internally is not detected and runs without them.
 */
export function azureCredentialProgram(source: string): string | undefined {
  for (const tokens of simpleCommands(source)) {
    let index = 0;
    while (index < tokens.length) {
      const redirection = REDIRECTION.exec(tokens[index]!);
      if (redirection) index += redirection[1] ? 1 : 2;
      else if (ASSIGNMENT.test(tokens[index]!) || SHELL_KEYWORDS.has(tokens[index]!)) index += 1;
      else break;
    }
    const program = azureInvocation(tokens, index);
    if (program) return program;
  }
  return undefined;
}

function azureInvocation(tokens: string[], index: number): string | undefined {
  const word = commandWord(tokens[index] ?? "");
  const args = tokens.slice(index + 1);
  if (WRAPPER_VALUE_OPTIONS[word]) {
    if (word === "env") {
      const splitString = envSplitString(args);
      if (splitString !== undefined) return azureCredentialProgram(splitString);
    }
    return azureInvocation(tokens, wrappedCommandIndex(word, tokens, index + 1));
  }
  if (word === "eval") return azureCredentialProgram(args.join(" "));
  if (SHELL_PROGRAMS.has(word)) {
    const scriptFlag = args.findIndex((arg) => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg));
    return scriptFlag === -1 ? undefined : azureCredentialProgram(args[scriptFlag + 1] ?? "");
  }
  return AZURE_CREDENTIAL_PROGRAMS.has(word) ? word : undefined;
}

export const AZURE_SESSION_CHOICE = "Allow Azure for this session";

/**
 * Asks whether one command may use the Azure CLI credentials. "Allow once" grants this command only; the session
 * choice grants every later Azure command in this Pi session without asking again.
 */
export async function requestAzureCredentials(
  ctx: { hasUI: boolean; ui: { select: (title: string, options: string[]) => Promise<string | undefined> } },
  program: string,
  command: string,
): Promise<"once" | "session" | "denied"> {
  if (!ctx.hasUI) return "denied";
  const choice = await ctx.ui.select(
    `Give this command access to your Azure CLI credentials (~/.azure)?\nProgram: ${program}\nCommand: ${command}`,
    ["Allow once", AZURE_SESSION_CHOICE, "Deny"],
  );
  if (choice === "Allow once") return "once";
  return choice === AZURE_SESSION_CHOICE ? "session" : "denied";
}

export async function requestCommandConfirmation(
  ctx: { hasUI: boolean; ui: { select: (title: string, options: string[]) => Promise<string | undefined> } },
  match: ConfirmedCommand,
  command: string,
): Promise<boolean> {
  if (!ctx.hasUI) return false;
  const choice = await ctx.ui.select(
    `Allow ${match.category} command?\nProgram: ${match.program}\nCommand: ${command}`,
    ["Allow once", "Deny"],
  );
  return choice === "Allow once";
}
