import { isBashToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { limitBashResultContent } from "./limiter.ts";

export default function bashResultLimiter(pi: ExtensionAPI) {
  pi.on("tool_result", (event) => {
    if (!isBashToolResult(event)) return undefined;

    const limited = limitBashResultContent(event.content, process.env.PI_SESSION_TMPDIR, event.details?.fullOutputPath);
    if (!limited) return undefined;

    // Redirect the rendered full-output pointer at the private copy; Pi's own spilled file stays.
    return { content: limited.content, details: { ...event.details, fullOutputPath: limited.fullOutputPath } };
  });
}
