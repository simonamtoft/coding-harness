import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { createGuideLedger, repeatReadReason, succeededBashCommands } from "./guides.ts";

export default function backlogGuardExtension(pi: ExtensionAPI) {
  const ledger = createGuideLedger();

  // A resumed session replays its conversation into a fresh process, so the
  // ledger has to be rebuilt from context or the limit becomes once-per-process.
  pi.on("session_start", (_event, ctx) => {
    const messages = ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages);
    for (const command of succeededBashCommands(messages)) ledger.record(command);
  });

  pi.on("session_compact", () => {
    ledger.forget();
  });

  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return undefined;

    const repeats = ledger.repeats(event.input.command);
    if (repeats.length === 0) return undefined;
    return { block: true, reason: repeatReadReason(repeats) };
  });

  // Recorded from the result, not the call: a command that another guard blocked
  // or that failed before its guide segment ran never put the text in context.
  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash" || event.isError) return undefined;

    const command = (event.input as { command?: unknown }).command;
    if (typeof command === "string") ledger.record(command);
    return undefined;
  });
}
