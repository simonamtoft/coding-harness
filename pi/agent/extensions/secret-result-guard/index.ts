import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { protectedEnvironmentValues, sanitizeToolResult } from "./guard.ts";

export default function secretResultGuard(pi: ExtensionAPI) {
  const protectedValues = protectedEnvironmentValues(process.env);

  pi.on("tool_result", (event) => sanitizeToolResult(event.content, event.details, protectedValues));
}
