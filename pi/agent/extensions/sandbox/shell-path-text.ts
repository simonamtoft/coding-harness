const INTERPRETERS = new Set(["node", "bun", "deno", "python", "python3", "perl", "ruby"]);
/** Commands that copy heredoc bodies to output or a file as data; the shell never interprets the body. */
const DATA_SINKS = new Set(["cat", "tee"]);
const PROGRAM_COMMANDS = new Set(["sed", "gsed", "awk", "gawk", "mawk", "nawk"]);
/** Commands whose quoted arguments are only printed or stored as text; `undefined` means every argument. */
const PROSE_ARGUMENTS: Record<string, Set<string> | undefined> = {
  backlog: undefined,
  echo: undefined,
  printf: undefined,
  git: new Set(["-m", "--message"]),
  gh: new Set(["-t", "--title", "-b", "--body"]),
};
/** Prose commands that store their text instead of printing it, so no pipeline can turn the text into file operands. */
const STORED_PROSE = new Set(["backlog", "git", "gh"]);
/** Unary `test` operators that only check whether a file exists or its type and permissions. */
const FILE_TEST_OPERATORS = new Set(["-e", "-f", "-d", "-s", "-r", "-w", "-x", "-L", "-h"]);
const FIND_PATTERN_OPTIONS = new Set(["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename"]);
const FIND_FILE_ACTIONS = /^-(?:exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/;
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const LITERAL_PIECE = /[^\s'"`()[\]{},;=]+/g;
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
// awk programs that can redirect output, pipe, run commands, or open files named in code through ARGV/ARGC.
const AWK_SIDE_EFFECT = /system|getline|close|ARGV|ARGC|[|>]/;

type Quote = { start: number; end: number; content: string };
type Word = { start: number; end: number; value: string; quotes: Quote[] };
type Blank = (start: number, end: number, capture?: boolean) => void;

/**
 * Masks shell text that names no file the shell itself opens, so lexical path extraction does not mistake it for
 * a path: quoted-delimiter heredoc bodies fed to interpreters or copied by `cat`/`tee`, side-effect-free `sed`/`awk` programs, and quoted
 * prose given to commands that only print or store text. Masked text is returned as `literals` so callers still
 * check it for protected secret paths. Operands accepted by `isProbeName` are masked without becoming literals when
 * an existence or ignore probe names them outside a pipeline or substitution, or when stored prose mentions them.
 * Commands whose quoting this scanner cannot follow (ANSI-C `$'…'` strings, or substitutions inside double quotes,
 * which may nest further quotes) are returned unchanged.
 */
export function maskNonPathText(
  command: string,
  isProbeName: (value: string) => boolean = () => false,
): { command: string; literals: string[] } {
  const unchanged = { command, literals: [] };
  if (command.includes("$'")) return unchanged;
  const masked = command.split("");
  const literals: string[] = [];
  const blank: Blank = (start, end, capture = true) => {
    if (capture) literals.push(masked.slice(start, end).join(""));
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
  const endCommand = (terminator = "") => {
    endWord();
    maskCommand(words, blank, isProbeName, terminator);
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
      endCommand(char);
      index += 1;
      readHeredocBodies();
    } else if (";&|()".includes(char)) {
      endCommand(command.startsWith("||", index) ? "||" : char);
      index += command.startsWith("||", index) ? 2 : 1;
    } else if (/\s/.test(char)) {
      endWord();
      index += 1;
    } else if (char === "#" && !word) {
      while (index < command.length && command[index] !== "\n") index += 1;
    } else if (command.startsWith("<<<", index)) {
      endWord();
      index += 3;
    } else if (command.startsWith("<<", index)) {
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
      const name = heredocProgram(words);
      pendingHeredocs.push({ delimiter, stripTabs, code: quoted && (INTERPRETERS.has(name) || DATA_SINKS.has(name)) });
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

/** The program reading a heredoc: the command, or the interpreter named directly after `uv run`. */
function heredocProgram(words: Word[]): string {
  const index = commandIndex(words);
  const name = commandName(words);
  if (name !== "uv" || words[index + 1]?.value !== "run") return name;
  return words[index + 2]?.value.split("/").at(-1) ?? "";
}

/** Whether a `sed` script only prints, deletes, or substitutes: no `w`, `r`, `e`, or `W` commands. */
export function isSideEffectFreeSedProgram(program: string): boolean {
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
  return name.endsWith("awk") ? !AWK_SIDE_EFFECT.test(awkCodeOutsideLiterals(program)) : isSideEffectFreeSedProgram(program);
}

/**
 * awk program text with string and regex literals removed, and `||` and `>=` operators blanked, so the side-effect
 * check sees only pipes and redirections in code. A `/` opens a regex only where an operand is expected (program
 * start or after `{ } ; ( , ! ~ & |` or a newline); elsewhere it is division.
 */
function awkCodeOutsideLiterals(program: string): string {
  let code = "";
  for (let index = 0; index < program.length; index += 1) {
    const char = program[index]!;
    if (char === "\"" || (char === "/" && /(?:^|[{};(,!~&|\n])\s*$/.test(code))) {
      let end = index + 1;
      while (end < program.length && program[end] !== char) end += program[end] === "\\" ? 2 : 1;
      code += "\"\"";
      index = end;
    } else {
      code += char;
    }
  }
  return code.replace(/\|\||>=/g, " ");
}

function isRedirectTarget(words: Word[], index: number): boolean {
  return /^\d*[<>]/.test(words[index]!.value) || /[<>]$/.test(words[index - 1]?.value ?? "");
}

function isQuotedProse(content: string): boolean {
  return /\s/.test(content) && !content.includes("$") && !PATH_LIKE_START.test(content)
    && !PARENT_SEGMENT.test(content) && !CONTROL_PATH_TEXT.test(content);
}

/**
 * Word indexes that `ls`, `test`/`[`/`[[` file tests, `git check-ignore`, or `find` name patterns only probe for
 * existence or ignore status. `find` with an action that runs commands, deletes, or writes files probes nothing.
 */
function probeOperandIndexes(name: string, words: Word[], start: number): number[] {
  const after = words.map((_, index) => index).filter((index) => index > start && !isRedirectTarget(words, index));
  const isOption = (index: number) => words[index]!.value.startsWith("-");
  if (name === "ls") return after.filter((index) => !isOption(index));
  if (["test", "[", "[["].includes(name)) return after.filter((index) => FILE_TEST_OPERATORS.has(words[index - 1]!.value));
  if (name === "find") {
    if (after.some((index) => FIND_FILE_ACTIONS.test(words[index]!.value))) return [];
    return after.filter((index) => FIND_PATTERN_OPTIONS.has(words[index - 1]!.value));
  }
  if (name !== "git") return [];
  let subcommand = start + 1;
  while (subcommand < words.length && isOption(subcommand)) {
    subcommand += GIT_VALUE_OPTIONS.has(words[subcommand]!.value) ? 2 : 1;
  }
  if (words[subcommand]?.value !== "check-ignore") return [];
  return after.filter((index) => index > subcommand && !isOption(index));
}

/** Masks probe names inside stored prose, such as a dot-env file mentioned in a task plan. */
function blankProbePieces(quote: Quote, blank: Blank, isProbeName: (value: string) => boolean): void {
  for (const piece of quote.content.matchAll(LITERAL_PIECE)) {
    const start = quote.start + 1 + piece.index!;
    if (isProbeName(piece[0])) blank(start, start + piece[0].length, false);
  }
}

function maskCommand(words: Word[], blank: Blank, isProbeName: (value: string) => boolean, terminator: string): void {
  const start = commandIndex(words);
  const name = commandName(words);
  if (PROGRAM_COMMANDS.has(name)) {
    for (const index of programWordIndexes(name, words, start + 1)) {
      const word = words[index]!;
      if (isSideEffectFreeProgram(name, word)) blank(word.start, word.end);
    }
    return;
  }
  // A pipeline or substitution could turn a probe's or printed prose's output into another command's file operands.
  const feedsAnotherCommand = ["|", ")"].includes(terminator);
  if (!feedsAnotherCommand) {
    for (const index of probeOperandIndexes(name, words, start)) {
      const word = words[index]!;
      if (isProbeName(word.value)) blank(word.start, word.end, false);
    }
  }
  if (!Object.hasOwn(PROSE_ARGUMENTS, name) || (feedsAnotherCommand && !STORED_PROSE.has(name))) return;
  const options = PROSE_ARGUMENTS[name];
  for (let index = start + 1; index < words.length; index += 1) {
    const word = words[index]!;
    const option = word.value.match(/^(--?[\w-]+)=/)?.[1] ?? words[index - 1]!.value;
    if ((options && !options.has(option)) || isRedirectTarget(words, index)) continue;
    for (const quote of word.quotes) {
      if (STORED_PROSE.has(name)) blankProbePieces(quote, blank, isProbeName);
      if (isQuotedProse(quote.content)) blank(quote.start, quote.end);
    }
  }
}
