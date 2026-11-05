import { appendFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Resolved through the ~/.pi/agent/extensions symlink so every project's sessions report into this checkout.
const PAPERCUTS_FILE = resolve(dirname(realpathSync.native(__filename)), "../../../..", "PAPERCUTS.md");

const HEADER = `# Papercuts

Harness friction reported by Pi agents through \`report_papercut\`. Untracked: entries name local projects.
Review periodically, turn recurring items into Backlog tasks or decisions, then delete handled entries.
`;

const CATEGORIES = ["sandbox", "instruction", "skill", "tool", "verifier", "other"] as const;

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatPapercut(entry: {
  timestamp: string;
  category: string;
  cwd: string;
  sessionId: string;
  problem: string;
  suggestion?: string;
}): string {
  const lines = [
    "",
    `## ${entry.timestamp} · ${entry.category}`,
    `- cwd: ${entry.cwd}`,
    `- session: ${entry.sessionId}`,
    `- problem: ${oneLine(entry.problem)}`,
  ];
  if (entry.suggestion?.trim()) lines.push(`- suggestion: ${oneLine(entry.suggestion)}`);
  return `${lines.join("\n")}\n`;
}

function appendPapercut(file: string, text: string) {
  try {
    writeFileSync(file, HEADER, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  appendFileSync(file, text);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "report_papercut",
    label: "Report Papercut",
    description: "Record friction caused by the coding-agent harness itself (sandbox denials, unclear or conflicting instructions, missing or misleading skills, tool errors, verifier problems) in a central log the user reviews later. Not for defects in the user's project.",
    promptSnippet: "Record coding-agent harness friction for later review",
    promptGuidelines: [
      "Use report_papercut once per distinct papercut when the harness itself (instructions, skills, sandbox, tools, verifier) blocked, misled, or slowed you; do not report defects in the user's project or ordinary task difficulty, and continue the task afterward.",
    ],
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    parameters: Type.Object({
      category: Type.Union(CATEGORIES.map((value) => Type.Literal(value))),
      problem: Type.String({ minLength: 1, description: "One or two sentences: what happened and what it cost" }),
      suggestion: Type.Optional(Type.String({ description: "Concrete harness change that would have avoided it" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      appendPapercut(PAPERCUTS_FILE, formatPapercut({
        timestamp: new Date().toISOString(),
        category: params.category,
        cwd: ctx.sessionManager.getCwd(),
        sessionId: ctx.sessionManager.getSessionId(),
        problem: params.problem,
        suggestion: params.suggestion,
      }));
      return { content: [{ type: "text", text: "Papercut recorded." }], details: undefined };
    },
  });
}
