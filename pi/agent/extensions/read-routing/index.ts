import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { bulkReaderFooter, createBulkReaderSession, recordBulkReaderResult, resetBulkReaderSession } from "./coverage.ts";
import { bulkReadRedirect } from "./routing.ts";

export default function readRouting(pi: ExtensionAPI) {
  const session = createBulkReaderSession();

  pi.on("session_start", () => resetBulkReaderSession(session));

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "read") return;
    const reason = bulkReadRedirect(event.input, ctx.cwd, session);
    if (reason) return { block: true, reason };
  });

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "subagent") return;
    const outcome = recordBulkReaderResult(session, event.input, event.details, ctx.cwd);
    if (!outcome) return;
    const footer = bulkReaderFooter(outcome, ctx.cwd);
    if (!footer) return;
    return { content: [...event.content, { type: "text", text: footer }] };
  });
}
