const INTERPRETERS = new Set(["node", "bun", "deno", "python", "python3", "perl", "ruby"]);
const PROGRAM_COMMANDS = new Set(["sed", "gsed", "awk", "gawk", "mawk", "nawk"]);
/** Commands whose quoted arguments are only printed or stored as text; `undefined` means every argument. */
const PROSE_ARGUMENTS: Record<string, Set<string> | undefined> = {
  backlog: undefined,
  echo: undefined,
  printf: undefined,
  git: new Set(["-m", "--message"]),
  gh: new Set(["-t", "--title", "-b", "--body"]),
};
const LEADING_KEYWORDS = new Set(["if", "elif", "while", "until", "do", "then", "else", "!", "{"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PATH_LIKE_START = /^(?:~|\/|\.{1,2}(?:\/|$))/;
const PARENT_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/;
const CONTROL_PATH_TEXT = /(?:^|[\s/])(?:\.pi|\.agents)(?:[\s/]|$)|AGENTS(?:\.override)?\.md|CLAUDE\.md|\.agent\/(?:verify|diagnostics)\.sh|\.git\/(?:config|hooks)/;
const LITERAL_SEPARATORS = /[\s'"`()[\]{},;=]+/;

// Print, delete, and substitute commands with optional line or regex addresses; no `w`, `r`, `e`, or `W` writes.
const SED_ADDRESS = String.raw`(?:\d+|\$|/(?:\\.|[^/\\])*/I?)`;
const SED_COMMAND = String.raw`(?:[pdP=]|s(?<delimiter>[^\s\\\n])(?:\\.|(?!\k<delimiter>)[^\\])*\k<delimiter>(?:\\.|(?!\k<delimiter>)[^\\])*\k<delimiter>[gpiI0-9]*)`;
const SAFE_SED_STEP = new RegExp(String.raw`^\s*(?:${SED_ADDRESS}(?:\s*,\s*(?:${SED_ADDRESS}|\+\d+))?)?\s*!?\s*${SED_COMMAND}\s*(?:[;\n]|$)`);
// awk programs that can redirect output, pipe, or run commands.
const AWK_SIDE_EFFECT = /system|getline|close|[|>]/;

type Word = { start: number; end: number; value: string; quotes: Array<{ start: number; end: number; content: string }> };

/**
 * Masks shell text that names no file the shell itself opens, so lexical path extraction does not mistake it for
 * a path: quoted-delimiter heredoc bodies fed to interpreters, side-effect-free `sed`/`awk` programs, and quoted
 * prose given to commands that only print or store text. Masked text is returned as `literals` so callers still
 * check it for protected secret paths. Commands whose quoting this scanner cannot follow (ANSI-C `$'…'` strings,
 * or substitutions inside double quotes, which may nest further quotes) are returned unchanged.
 */
export function maskNonPathText(command: string): { command: string; literals: string[] } {
  const unchanged = { command, literals: [] };
  if (command.includes("$'")) return unchanged;
  const masked = command.split("");
  const literals: string[] = [];
  const blank = (start: number, end: number) => {
    literals.push(command.slice(start, end));
    for (let index = start; index < end; index += 1) if (masked[index] !== "\n") masked[index] = " ";
  };
  const pendingHeredocs: Array<{ delimiter: string; stripTabs: boolean; code: boolean }> = [];
  let words: Word[] = [];
  let word: Word | undefined;
  let index = 0;

  const endWord = () => {
    if (word) words.push({ ...word, end: index });
    word = undefined;
  };
  const endCommand = () => {
    endWord();
    maskCommand(words, blank);
    words = [];
  };
  const startWord = () => {
    word ??= { start: index, end: index, value: "", quotes: [] };
    return word;
  };
  const readHeredocBodies = () => {
    for (const { delimiter, stripTabs, code } of pendingHeredocs.splice(0)) {
      const bodyStart = index;
      let closed = false;
      let bodyEnd = index;
      while (index < command.length && !closed) {
        const newline = command.indexOf("\n", index);
        const lineEnd = newline === -1 ? command.length : newline;
        const line = command.slice(index, lineEnd);
        closed = (stripTabs ? line.replace(/^\t+/, "") : line) === delimiter;
        if (!closed) bodyEnd = lineEnd;
        index = lineEnd + 1;
      }
      // An unclosed body may be shell text the guard must still inspect.
      if (code && closed) blank(bodyStart, bodyEnd);
    }
  };

  while (index < command.length) {
    const char = command[index]!;
    if (char === "\n") {
      endCommand();
      index += 1;
      readHeredocBodies();
    } else if (";&|()".includes(char)) {
      endCommand();
      index += 1;
    } else if (/\s/.test(char)) {
      endWord();
      index += 1;
    } else if (char === "#" && !word) {
      while (index < command.length && command[index] !== "\n") index += 1;
    } else if (command.startsWith("<<", index) && !command.startsWith("<<<", index)) {
      endWord();
      index += 2;
      const stripTabs = command[index] === "-";
      if (stripTabs) index += 1;
      while (command[index] === " " || command[index] === "\t") index += 1;
      let delimiter = "";
      let quoted = false;
      while (index < command.length && !/[\s;&|<>()]/.test(command[index]!)) {
        if ("'\"\\".includes(command[index]!)) quoted = true;
        else delimiter += command[index];
        index += 1;
      }
      // Unquoted bodies still expand `$(…)` and backticks in the shell before the interpreter runs.
      pendingHeredocs.push({ delimiter, stripTabs, code: quoted && INTERPRETERS.has(commandName(words)) });
    } else if (char === "\\") {
      startWord().value += command[index + 1] ?? "";
      index += 2;
    } else if (char === "'" || char === "\"") {
      const current = startWord();
      const end = closingQuote(command, index + 1, char);
      if (end === -1) {
        // Unclosed quote: leave the rest for the existing lexical scan.
        current.value += command.slice(index);
        index = command.length;
      } else {
        const content = command.slice(index + 1, end);
        if (char === "\"" && /\$\(|`/.test(content)) return unchanged;
        current.quotes.push({ start: index, end: end + 1, content });
        current.value += content;
        index = end + 1;
      }
    } else {
      startWord().value += char;
      index += 1;
    }
  }
  endCommand();
  return { command: masked.join(""), literals };
}

/** Whitespace-separated pieces of masked literals, for protected-secret checks only. */
export function literalSecretCandidates(literals: string[]): string[] {
  return literals.flatMap((literal) => literal.split(LITERAL_SEPARATORS)).filter(Boolean);
}

function closingQuote(source: string, start: number, quote: string): number {
  for (let index = start; index < source.length; index += 1) {
    if (quote === "\"" && source[index] === "\\") index += 1;
    else if (source[index] === quote) return index;
  }
  return -1;
}

function commandIndex(words: Word[]): number {
  let index = 0;
  while (index < words.length
    && (LEADING_KEYWORDS.has(words[index]!.value) || (words[index]!.quotes.length === 0 && ASSIGNMENT.test(words[index]!.value)))) {
    index += 1;
  }
  return index;
}

function commandName(words: Word[]): string {
  return words[commandIndex(words)]?.value.split("/").at(-1) ?? "";
}

function isSafeSedProgram(program: string): boolean {
  let rest = program;
  while (rest.trim()) {
    const step = SAFE_SED_STEP.exec(rest);
    if (!step || step[0].length === 0) return false;
    rest = rest.slice(step[0].length);
  }
  return true;
}

/** Word indexes holding inline `sed`/`awk` program text: `-e` values or the first operand; none for `-f` programs. */
function programWordIndexes(name: string, words: Word[], start: number): number[] {
  const sed = !name.endsWith("awk");
  const programs: number[] = [];
  let fromFile = false;
  let operand: number | undefined;
  for (let index = start; index < words.length; index += 1) {
    const value = words[index]!.value;
    if (value === "--") {
      operand ??= index + 1 < words.length ? index + 1 : undefined;
      break;
    }
    if (sed && (value === "-e" || value === "--expression")) {
      if (index + 1 < words.length) programs.push(index + 1);
      index += 1;
    } else if (sed && value.startsWith("--expression=")) {
      programs.push(index);
    } else if (value === "-f" || value === "--file") {
      fromFile = true;
      index += 1;
    } else if (value.startsWith("--file=") || (value.startsWith("-f") && value.length > 2 && !sed)) {
      fromFile = true;
    } else if (!sed && (value === "-v" || value === "-F")) {
      index += 1;
    } else if (sed && value === "-l") {
      index += 1;
    } else if (!value.startsWith("-") || value === "-") {
      operand ??= index;
      break;
    }
  }
  if (programs.length > 0 || fromFile) return programs;
  return operand === undefined ? [] : [operand];
}

function isSideEffectFreeProgram(name: string, word: Word): boolean {
  const program = word.value.replace(/^--expression=/, "");
  return name.endsWith("awk") ? !AWK_SIDE_EFFECT.test(program) : isSafeSedProgram(program);
}

function isRedirectTarget(words: Word[], index: number): boolean {
  return /^\d*[<>]/.test(words[index]!.value) || /[<>]$/.test(words[index - 1]?.value ?? "");
}

function isQuotedProse(content: string): boolean {
  return /\s/.test(content) && !content.includes("$") && !PATH_LIKE_START.test(content)
    && !PARENT_SEGMENT.test(content) && !CONTROL_PATH_TEXT.test(content);
}

function maskCommand(words: Word[], blank: (start: number, end: number) => void): void {
  const start = commandIndex(words);
  const name = commandName(words);
  if (PROGRAM_COMMANDS.has(name)) {
    for (const index of programWordIndexes(name, words, start + 1)) {
      const word = words[index]!;
      if (isSideEffectFreeProgram(name, word)) blank(word.start, word.end);
    }
    return;
  }
  if (!Object.hasOwn(PROSE_ARGUMENTS, name)) return;
  const options = PROSE_ARGUMENTS[name];
  for (let index = start + 1; index < words.length; index += 1) {
    const word = words[index]!;
    const option = word.value.match(/^(--?[\w-]+)=/)?.[1] ?? words[index - 1]!.value;
    if ((options && !options.has(option)) || isRedirectTarget(words, index)) continue;
    for (const quote of word.quotes) if (isQuotedProse(quote.content)) blank(quote.start, quote.end);
  }
}
