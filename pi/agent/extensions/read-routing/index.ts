import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { bulkReadRedirect } from "./routing.ts";

export default function readRouting(pi: ExtensionAPI) {
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "read") return;
    const reason = bulkReadRedirect(event.input, ctx.cwd);
    if (reason) return { block: true, reason };
  });
}
