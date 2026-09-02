import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderCall, renderResult } from "./render.ts";
import { askQuestionTool, CLARIFICATION_GATE } from "./tool.ts";

export default function askQuestionExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${CLARIFICATION_GATE}`,
  }));

  pi.registerTool({ ...askQuestionTool, renderCall, renderResult } as Parameters<
    ExtensionAPI["registerTool"]
  >[0]);
}
