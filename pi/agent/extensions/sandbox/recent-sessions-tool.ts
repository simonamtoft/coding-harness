import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { currentRepositoryRoot, listRecentSessionHistory, sessionHistoryRoot } from "./session-history.ts";

const Session = Type.Object({
  path: Type.String(),
  id: Type.String(),
  timestamp: Type.String(),
  cwd: Type.String(),
});

export function registerRecentSessionsTool(pi: ExtensionAPI, cwd: string) {
  const repositoryRoot = currentRepositoryRoot(cwd);
  pi.registerTool({
    name: "recent_sessions",
    label: "Recent Sessions",
    description: "List the newest Pi sessions started in this Git repository. Returns transcript paths; use the read tool to inspect a session. Does not search other repositories or read transcript contents.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    parameters: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum sessions to return (default 25)" })) }),
    outputSchema: Type.Object({ sessions: Type.Array(Session) }),
    async execute(_toolCallId, params) {
      if (!repositoryRoot) throw new Error("Recent sessions require a Git repository narrower than the home directory");
      const sessions = await listRecentSessionHistory(sessionHistoryRoot(), repositoryRoot, params.limit ?? 25);
      const result = { sessions };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, details: undefined };
    },
  });
}
