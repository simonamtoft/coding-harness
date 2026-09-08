import { isBashToolResult, truncateTail, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { limitBashResultContent } from "./limiter.ts";

export default function bashResultLimiter(pi: ExtensionAPI) {
  pi.on("tool_result", (event) => {
    if (!isBashToolResult(event)) return undefined;

    return limitBashResultContent(event.content, process.env.PI_SESSION_TMPDIR, truncateTail, event.details?.fullOutputPath);
  });
}
