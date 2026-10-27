import { isAbsolute, join, resolve } from "node:path";

/** How the guard resolves `cd` targets; all paths it returns are absolute. */
export type ShellDirectoryContext = {
  cwd: string;
  home: string;
  /** Real path of an absolute path, resolving the longest existing prefix. */
  realpath: (path: string) => string;
  isDirectory: (path: string) => boolean;
  /** Variables whose values the guard knows, such as `PI_SESSION_TMPDIR`. */
  variables?: Record<string, string>;
};

/**
 * One simple command. `directories` lists every working directory it may run in (undefined: the session root);
 * `targets` holds `cd` targets the guard expanded from known variables, which callers must check like paths.
 */
export type ShellSegment = { text: string; directories?: string[]; targets: string[] };

type Separator = "start" | "&&" | "||" | "|" | ";" | "&" | ")";
type Scope = { buffer: string; current: string[]; pending: string[] | undefined; previous: Separator; seen: string[] };
type DirectoryChange = { target: string; expanded: boolean } | "previous" | "unknown";

const DIRECTORY_COMMANDS = new Set(["cd", "pushd", "popd"]);
/** Words after which a command runs only when an `if`, `while`, or loop condition allows it. */
const CONDITIONAL_BODY_WORDS = new Set(["then", "else", "elif", "do"]);
const LEADING_WORDS = new Set(["if", "elif", "while", "until", "do", "then", "else", "!", "{", "time", "command", "builtin"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_WORD = /'([^']*)'|"((?:\\.|[^"\\])*)"|(\S+)/g;

function union(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
}

/** The directory change a simple command makes, if it is `cd`, `pushd`, or `popd`. */
function directoryChange(text: string, context: ShellDirectoryContext): DirectoryChange | undefined {
  const words = [...text.matchAll(SHELL_WORD)].map(([, single, double, bare]) => single ?? double ?? bare ?? "");
  let index = 0;
  while (index < words.length && (LEADING_WORDS.has(words[index]!) || ASSIGNMENT.test(words[index]!))) index += 1;
  if (!DIRECTORY_COMMANDS.has(words[index] ?? "")) return undefined;
  if (words[index] === "popd") return "previous";
  const args = words.slice(index + 1);
  const optionsEnd = args.indexOf("--");
  const operand = optionsEnd === -1 ? args.find((arg) => !/^-[LPe@]+$/.test(arg)) : args[optionsEnd + 1];
  if (operand === undefined) return { target: context.home, expanded: false };
  let target = operand.replace(/^~(?=\/|$)/, context.home);
  let expanded = false;
  target = target.replace(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/, (match, braced?: string, bare?: string) => {
    const value = context.variables?.[(braced ?? bare)!];
    if (value === undefined) return match;
    expanded = true;
    return value;
  });
  if (target === "-") return "previous";
  if (/[$`*?[]/.test(target)) return "unknown";
  return { target, expanded };
}

/**
 * Splits shell text into simple commands, outside quotes, and tracks the working directory each may run in. A
 * literal `cd`/`pushd` changes the directory for later commands in the same (sub)shell; `( … )` and `$( … )` scope
 * changes to their body, and pipeline or background members change nothing. Where the `cd` may not take effect
 * (its target is not an enterable directory yet, or it runs only after `&&`/`||` or in an `if`/loop body), later
 * commands outside its `&&` chain may run
 * in either directory, so both are reported. `popd` and `cd -` may return to any directory seen in the scope. A `cd`
 * to an unknown target, such as an unknown variable, leaves the tracked directory unchanged. Heredoc bodies are
 * still returned for inspection, but their `cd`s cannot move this shell: they are data or another program's input.
 */
export function shellSegments(text: string, context?: ShellDirectoryContext): ShellSegment[] {
  const segments: ShellSegment[] = [];
  const scopes: Scope[] = [];
  const initial = context ? [context.cwd] : [];
  let scope: Scope = { buffer: "", current: initial, pending: undefined, previous: "start", seen: initial };
  const heredocs: Array<{ delimiter: string; stripTabs: boolean }> = [];

  const finish = (next: Separator) => {
    const segmentText = scope.buffer;
    scope.buffer = "";
    const directories = context && !(scope.current.length === 1 && scope.current[0] === context.cwd) ? scope.current : undefined;
    const change = context ? directoryChange(segmentText, context) : undefined;
    const literal = typeof change === "object" ? change : undefined;
    const targets = literal?.expanded
      ? scope.current.map((directory) => resolve(directory, literal.target))
      : [];
    if (segmentText.trim()) segments.push({ text: segmentText, directories, targets });
    const inPipeline = scope.previous === "|" || next === "|" || next === "&";
    if (context && change === "previous" && !inPipeline) {
      scope.current = scope.seen;
      scope.pending = undefined;
    } else if (context && literal && !inPipeline) {
      const destinations = scope.current.map((directory) =>
        context.realpath(isAbsolute(literal.target) ? literal.target : join(directory, literal.target)));
      scope.seen = union(scope.seen, destinations);
      const firstWord = segmentText.trim().split(/\s+/)[0] ?? "";
      const unconditional = !["&&", "||"].includes(scope.previous) && !CONDITIONAL_BODY_WORDS.has(firstWord);
      const certain = unconditional && destinations.every((destination) => context.isDirectory(destination));
      const afterChain = certain ? destinations : union(scope.current, destinations);
      if (next === "&&") {
        scope.current = destinations;
        scope.pending = scope.pending ? union(scope.pending, afterChain) : afterChain;
      } else if (next === "||") {
        // The command after `||` runs only if this `cd` failed, so `current` stays the directory before it.
        scope.pending = scope.pending ? union(scope.pending, afterChain) : afterChain;
      } else {
        scope.current = scope.pending ? union(scope.pending, afterChain) : afterChain;
        scope.pending = undefined;
      }
    } else if (scope.pending && next !== "&&" && next !== "|") {
      scope.current = scope.pending;
      scope.pending = undefined;
    }
    scope.previous = next;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const two = text.slice(index, index + 2);
    if (char === "\\") {
      scope.buffer += text.slice(index, index + 2);
      index += 1;
    } else if (char === "'" || char === "\"") {
      let end = index + 1;
      while (end < text.length && text[end] !== char) end += char === "\"" && text[end] === "\\" ? 2 : 1;
      scope.buffer += text.slice(index, end + 1);
      index = end;
    } else if (char === "#" && /(?:^|\s)$/.test(scope.buffer)) {
      while (index + 1 < text.length && text[index + 1] !== "\n") index += 1;
    } else if (text.startsWith("<<<", index)) {
      scope.buffer += " ";
      index += 2;
    } else if (two === "<<") {
      let end = index + 2;
      const stripTabs = text[end] === "-";
      if (stripTabs) end += 1;
      while (text[end] === " " || text[end] === "\t") end += 1;
      let delimiter = "";
      while (end < text.length && !/[\s;&|<>()]/.test(text[end]!)) {
        if (!"'\"\\".includes(text[end]!)) delimiter += text[end];
        end += 1;
      }
      heredocs.push({ delimiter, stripTabs });
      scope.buffer += " ";
      index = end - 1;
    } else if (two === "&&" || two === "||") {
      finish(two);
      index += 1;
    } else if (char === "&" && (/[<>]$/.test(scope.buffer) || text[index + 1] === ">")) {
      scope.buffer += char;
    } else if (char === "|" || char === ";" || char === "&" || char === "\n") {
      finish(char === "\n" ? ";" : char);
      if (char === "\n") {
        for (const { delimiter, stripTabs } of heredocs.splice(0)) {
          const body: string[] = [];
          while (index + 1 < text.length) {
            const lineEnd = text.indexOf("\n", index + 1);
            const line = text.slice(index + 1, lineEnd === -1 ? text.length : lineEnd);
            index = lineEnd === -1 ? text.length : lineEnd;
            if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
            body.push(line);
          }
          // Body paths are still checked, against this shell's directory; its `cd`s cannot move this shell.
          const directories = context && !(scope.current.length === 1 && scope.current[0] === context.cwd) ? scope.current : undefined;
          for (const segment of shellSegments(body.join("\n"))) segments.push({ ...segment, directories });
        }
      }
    } else if (char === "(" || two === "$(") {
      if (char === "$") index += 1;
      scopes.push(scope);
      scope = { buffer: "", current: scope.current, pending: undefined, previous: "start", seen: scope.current };
    } else if (char === ")" && scopes.length > 0) {
      finish(")");
      const outer = scopes.pop()!;
      outer.buffer += " $SUBSTITUTION ";
      scope = outer;
    } else {
      scope.buffer += char;
    }
  }
  finish("start");
  while (scopes.length > 0) {
    scope = scopes.pop()!;
    finish("start");
  }
  return segments;
}
