export type ProbeRun = {
  /** Bash commands the agent actually executed, in order. */
  commands: string[];
  finalMessage: string;
};

type JsonEvent = Record<string, unknown>;

function assistantText(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return null;
  const record = message as Record<string, unknown>;
  if (record.role !== "assistant" || !Array.isArray(record.content)) return null;
  const text = record.content
    .filter((part): part is { type: string; text: string } =>
      typeof part === "object" && part !== null &&
      (part as Record<string, unknown>).type === "text" &&
      typeof (part as Record<string, unknown>).text === "string")
    .map((part) => part.text)
    .join("");
  return text.trim() === "" ? null : text.trim();
}

/**
 * Reads `pi --mode json` output. Command evidence comes from tool executions rather
 * than from the agent's own account of what it did.
 */
export function parseProbeRun(stdout: string): ProbeRun {
  const commands: string[] = [];
  let finalMessage = "";

  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let event: JsonEvent;
    try {
      event = JSON.parse(line) as JsonEvent;
    } catch {
      continue;
    }

    if (event.type === "tool_execution_start" && event.toolName === "bash") {
      const args = event.args;
      const command = typeof args === "object" && args !== null
        ? (args as Record<string, unknown>).command
        : undefined;
      if (typeof command === "string") commands.push(command);
      continue;
    }

    if (event.type === "turn_end") {
      const text = assistantText(event.message);
      if (text) finalMessage = text;
    }
  }

  return { commands, finalMessage };
}
