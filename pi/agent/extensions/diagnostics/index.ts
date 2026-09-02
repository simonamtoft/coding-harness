import {
  isEditToolResult,
  isWriteToolResult,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { formatDiagnosticResult, resolveDiagnostics, runDiagnostics } from "./diagnostics.ts";
import { DiagnosticsTrustGate } from "./trust.ts";

const DIAGNOSTIC_TIMEOUT_MS = 30_000;

export default function diagnostics(pi: ExtensionAPI) {
  let trustGate = new DiagnosticsTrustGate();

  pi.on("session_start", () => {
    trustGate = new DiagnosticsTrustGate();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const diagnostic = await resolveDiagnostics(ctx.cwd);
    if (!diagnostic || !ctx.isProjectTrusted()) return;

    const approved = await trustGate.requestApproval(
      ctx.cwd,
      ctx.hasUI,
      (title, message) => ctx.ui.confirm(title, message),
    );
    if (!approved) return;

    return {
      systemPrompt:
        `${event.systemPrompt}\n\nFast project diagnostics (${diagnostic.label}) are active after successful edits. ` +
        "Their output is advisory only: use it as immediate feedback, but the end-of-turn verifier remains the authoritative gate.",
    };
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || (!isEditToolResult(event) && !isWriteToolResult(event))) return;
    if (!ctx.isProjectTrusted()) return;

    const content = trustGate.approvedContent(ctx.cwd);
    if (!content) return;

    const result = await runDiagnostics(
      content,
      event.input.path,
      ctx.cwd,
      ctx.signal,
      DIAGNOSTIC_TIMEOUT_MS,
    );

    return {
      content: [...event.content, { type: "text", text: formatDiagnosticResult(result) }],
    };
  });
}
