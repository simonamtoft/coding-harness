import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderCall, renderResult } from "./render.ts";
import { askQuestionTool, clarificationGate } from "./tool.ts";

export default function askQuestionExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => ({
    systemPrompt: `${event.systemPrompt}\n\n${clarificationGate(ctx.mode)}`,
  }));

  pi.registerTool({ ...askQuestionTool, renderCall, renderResult } as Parameters<
    ExtensionAPI["registerTool"]
  >[0]);
}
