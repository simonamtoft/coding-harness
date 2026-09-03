/**
 * Recognized `backlog instructions` guides. The index form (no guide, or only
 * flags such as `--list`) is tracked under its own key so that reading the
 * router twice is caught like any other repeat.
 */
const GUIDE_NAMES = new Set(["overview", "task-creation", "task-execution", "task-finalization", "init-required"]);
const INDEX_KEY = "index";

/** Replaces quoted spans so that instruction text inside an argument cannot look like a command. */
function maskQuotedSpans(command: string): string {
  return command.replace(/'[^']*'/g, "__QUOTED__").replace(/"(?:\\.|[^"\\])*"/g, "__QUOTED__");
}

/**
 * Guides requested by executed `backlog instructions` segments in a Bash command.
 *
 * Only segments that *start* a command are considered, quoted spans are masked,
 * and anything from the first heredoc operator onward is ignored: instruction
 * text quoted inside an argument or written into a file is documentation, not a
 * read, and must not be recorded as one.
 */
export function requestedGuides(command: string): string[] {
  const executable = maskQuotedSpans(command.split("<<")[0] ?? "");
  const guides: string[] = [];

  for (const segment of executable.split(/&&|\|\||[;|\n]/)) {
    const match = /^\s*backlog\s+instructions(?<rest>\s+\S+)?/.exec(segment);
    if (!match) continue;
    const argument = match.groups?.rest?.trim();
    if (argument === undefined || argument.startsWith("-")) {
      guides.push(INDEX_KEY);
      continue;
    }
    if (GUIDE_NAMES.has(argument)) guides.push(argument);
  }

  return guides;
}

type ToolCallBlock = { type: string; id?: string; name?: string; arguments?: { command?: unknown } };

type ContextMessage =
  | { role: "assistant"; content: ToolCallBlock[] }
  | { role: "toolResult"; toolCallId: string; isError: boolean }
  | { role: string };

/**
 * Bash commands whose output is still in the given context and did not error.
 *
 * Used to rebuild the ledger when a session resumes in a new process. Reading
 * context entries rather than the session file is what makes compaction safe:
 * a guide dropped by compaction is no longer listed, so it may be read again.
 */
export function succeededBashCommands(messages: ContextMessage[]): string[] {
  const pending = new Map<string, string>();
  const succeeded: string[] = [];

  for (const message of messages) {
    if (message.role === "assistant" && "content" in message && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type !== "toolCall" || block.name !== "bash" || !block.id) continue;
        const command = block.arguments?.command;
        if (typeof command === "string") pending.set(block.id, command);
      }
      continue;
    }
    if (message.role !== "toolResult" || !("toolCallId" in message) || message.isError) continue;
    const command = pending.get(message.toolCallId);
    if (command !== undefined) succeeded.push(command);
  }

  return succeeded;
}

/** Tracks which guides are already in the conversation, so repeats can be refused. */
export function createGuideLedger() {
  let served = new Set<string>();

  return {
    /** The guides this command reads redundantly — already in context, or twice over — in command order. */
    repeats(command: string): string[] {
      const requested = requestedGuides(command);
      const repeats = requested.filter((guide, index) => served.has(guide) || requested.indexOf(guide) < index);
      return [...new Set(repeats)];
    },
    record(command: string): void {
      for (const guide of requestedGuides(command)) served.add(guide);
    },
    /** Compaction drops the guide text from context, so a re-read becomes legitimate. */
    forget(): void {
      served = new Set<string>();
    },
  };
}

export function repeatReadReason(repeats: string[]): string {
  const guides = repeats.map((guide) => (guide === INDEX_KEY ? "`backlog instructions`" : `\`backlog instructions ${guide}\``));
  return `${guides.join(" and ")} already ran in this session and the guide text is still in context.`
    + " Re-run the command without that segment and act on the guidance you already have.";
}
