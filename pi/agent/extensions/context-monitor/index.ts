import { resolve } from "node:path";
import {
  estimateTokens,
  formatSkillsForPrompt,
  sessionEntryToContextMessages,
  type BuildSystemPromptOptions,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type Skill,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isUiBusy, withUiLock } from "../shared/ui-lock.ts";

type BreakdownItem = {
  label: string;
  tokens: number;
  detail?: string;
  children?: BreakdownItem[];
};

type Breakdown = {
  total: number | null;
  contextWindow: number;
  percent: number | null;
  estimated: number;
  categories: BreakdownItem[];
};

function estimateChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function formatTokens(tokens: number): string {
  const sign = tokens < 0 ? "−" : "";
  const value = Math.abs(tokens);
  if (value < 1_000) return `${sign}${value}`;
  if (value < 10_000) return `${sign}${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000) return `${sign}${Math.round(value / 1_000)}k`;
  return `${sign}${(value / 1_000_000).toFixed(1)}M`;
}

function contextFileSegment(path: string, content: string): string {
  return `<project_instructions path="${path}">\n${content}\n</project_instructions>\n\n`;
}

function buildContextFileItems(options: BuildSystemPromptOptions): { tokens: number; items: BreakdownItem[] } {
  const files = options.contextFiles ?? [];
  if (files.length === 0) return { tokens: 0, items: [] };

  const prefix = "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n";
  const suffix = "</project_context>\n";
  const items = files.map((file) => {
    const segment = contextFileSegment(file.path, file.content);
    return {
      label: file.path,
      tokens: estimateChars(segment.length),
      detail: `${file.content.length.toLocaleString()} chars plus prompt framing`,
    };
  });
  const totalChars = prefix.length + suffix.length + files.reduce((sum, file) => sum + contextFileSegment(file.path, file.content).length, 0);
  const totalTokens = estimateChars(totalChars);
  const attributed = items.reduce((sum, item) => sum + item.tokens, 0);

  if (totalTokens !== attributed) {
    items.unshift({ label: "Context section framing", tokens: totalTokens - attributed });
  }
  return { tokens: totalTokens, items };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function skillSegment(skill: Skill): string {
  return [
    "  <skill>",
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${escapeXml(skill.description)}</description>`,
    `    <location>${escapeXml(skill.filePath)}</location>`,
    "  </skill>",
  ].join("\n");
}

function buildSkillItems(options: BuildSystemPromptOptions): { tokens: number; items: BreakdownItem[] } {
  const hasRead = !options.selectedTools || options.selectedTools.includes("read");
  const skills = (options.skills ?? []).filter((skill) => !skill.disableModelInvocation);
  if (!hasRead || skills.length === 0) return { tokens: 0, items: [] };

  const formatted = formatSkillsForPrompt(skills);
  const items = skills.map((skill) => ({
    label: skill.filePath,
    tokens: estimateChars(skillSegment(skill).length),
    detail: `${skill.name} — catalog description only; SKILL.md body is loaded after invocation`,
  }));
  const totalTokens = estimateChars(formatted.length);
  const attributed = items.reduce((sum, item) => sum + item.tokens, 0);

  if (totalTokens !== attributed) {
    items.unshift({ label: "Skill catalog framing", tokens: totalTokens - attributed });
  }
  return { tokens: totalTokens, items };
}

function normalizeReadPath(rawPath: string, cwd: string): string {
  const path = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
  return resolve(cwd, path);
}

function addReadFile(files: Map<string, { tokens: number; reads: number }>, path: string, tokens: number): void {
  const current = files.get(path) ?? { tokens: 0, reads: 0 };
  current.tokens += tokens;
  current.reads += 1;
  files.set(path, current);
}

function buildBreakdown(ctx: ExtensionCommandContext): Breakdown {
  const options = ctx.getSystemPromptOptions();
  const systemPrompt = ctx.getSystemPrompt();
  const contextFiles = buildContextFileItems(options);
  const skills = buildSkillItems(options);
  const systemTotal = estimateChars(systemPrompt.length);
  const systemBase = Math.max(0, systemTotal - contextFiles.tokens - skills.tokens);

  const messages = ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages);
  const readCalls = new Map<string, string>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall" || block.name !== "read") continue;
      const rawPath = block.arguments?.path;
      if (typeof rawPath === "string") readCalls.set(block.id, normalizeReadPath(rawPath, ctx.cwd));
    }
  }

  let conversationTokens = 0;
  let otherToolTokens = 0;
  const readFiles = new Map<string, { tokens: number; reads: number }>();

  for (const message of messages) {
    const tokens = estimateTokens(message);
    if (message.role === "toolResult") {
      const readPath = message.toolName === "read" ? readCalls.get(message.toolCallId) : undefined;
      if (readPath) addReadFile(readFiles, readPath, tokens);
      else otherToolTokens += tokens;
    } else if (message.role === "bashExecution") {
      otherToolTokens += tokens;
    } else {
      conversationTokens += tokens;
    }
  }

  const readFileItems = [...readFiles.entries()]
    .map(([path, usage]) => ({
      label: path,
      tokens: usage.tokens,
      detail: `${usage.reads} read${usage.reads === 1 ? "" : "s"} currently retained in context`,
    }))
    .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
  const readFileTokens = readFileItems.reduce((sum, item) => sum + item.tokens, 0);

  const categories: BreakdownItem[] = [
    { label: "System prompt", tokens: systemBase, detail: "Base prompt, tool guidance, appended prompts, and extension instructions" },
    { label: "Context files", tokens: contextFiles.tokens, children: contextFiles.items },
    { label: "Skills", tokens: skills.tokens, detail: "Skill catalog entries; full skill bodies count under read files after invocation", children: skills.items },
    { label: "Conversation", tokens: conversationTokens, detail: "User, assistant, reasoning, tool-call arguments, and summaries" },
    { label: "Read files", tokens: readFileTokens, children: readFileItems },
    { label: "Other tool output", tokens: otherToolTokens, detail: "Non-read tool results and user shell output" },
  ];

  const estimated = categories.reduce((sum, item) => sum + item.tokens, 0);
  const usage = ctx.getContextUsage();
  const hasProviderUsage = messages.some((message) => {
    if (message.role !== "assistant" || message.stopReason === "aborted" || message.stopReason === "error") return false;
    const reported = message.usage;
    return (reported.totalTokens || reported.input + reported.output + reported.cacheRead + reported.cacheWrite) > 0;
  });
  const total = hasProviderUsage ? usage?.tokens ?? null : null;
  const percent = total === null ? null : usage?.percent ?? null;

  if (total !== null) {
    const variance = total - estimated;
    categories.push({
      label: variance >= 0 ? "Provider/schema overhead" : "Estimator variance",
      tokens: variance,
      detail: variance >= 0
        ? "Provider formatting, tool schemas, and tokenization not attributable through Pi's public API"
        : "The conservative chars/4 estimates exceed the provider-reported aggregate",
    });
  }

  return {
    total,
    contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
    percent,
    estimated,
    categories,
  };
}

class ContextMonitorComponent {
  private readonly theme: Theme;
  private readonly done: () => void;
  private readonly breakdown: Breakdown;
  private stack: Array<{ title: string; items: BreakdownItem[] }>;
  private selected = 0;
  private scroll = 0;

  constructor(theme: Theme, breakdown: Breakdown, done: () => void) {
    this.theme = theme;
    this.done = done;
    this.breakdown = breakdown;
    this.stack = [{ title: "Context breakdown", items: breakdown.categories }];
  }

  handleInput(data: string): void {
    const view = this.stack[this.stack.length - 1]!;
    if (matchesKey(data, Key.escape)) {
      this.done();
      return;
    }
    if (matchesKey(data, Key.left) || matchesKey(data, Key.backspace)) {
      if (this.stack.length > 1) {
        this.stack.pop();
        this.selected = 0;
        this.scroll = 0;
      }
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selected = Math.max(0, this.selected - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selected = Math.min(view.items.length - 1, this.selected + 1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const item = view.items[this.selected];
      if (item?.children?.length) {
        this.stack.push({ title: item.label, items: item.children });
        this.selected = 0;
        this.scroll = 0;
      }
    }
  }

  render(width: number): string[] {
    const w = Math.max(4, width);
    const innerWidth = w - 2;
    const view = this.stack[this.stack.length - 1]!;
    const maxRows = 14;

    if (this.selected < this.scroll) this.scroll = this.selected;
    if (this.selected >= this.scroll + maxRows) this.scroll = this.selected - maxRows + 1;

    const border = (left: string, fill: string, right: string) => this.theme.fg("border", left + fill.repeat(innerWidth) + right);
    const row = (content = "", selected = false) => {
      const clipped = truncateToWidth(content, innerWidth, "…");
      const padded = clipped + " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
      const body = selected ? this.theme.bg("selectedBg", padded) : padded;
      return this.theme.fg("border", "│") + body + this.theme.fg("border", "│");
    };

    const totalLabel = this.breakdown.total === null ? "unknown" : formatTokens(this.breakdown.total);
    const windowLabel = this.breakdown.contextWindow > 0 ? formatTokens(this.breakdown.contextWindow) : "unknown";
    const percentLabel = this.breakdown.percent === null ? "?" : `${this.breakdown.percent.toFixed(1)}%`;
    const breadcrumb = this.stack.map((entry) => entry.title).join(" › ");
    const lines = [
      border("╭", "─", "╮"),
      row(` ${this.theme.bold(this.theme.fg("accent", breadcrumb))}`),
      row(` ${this.theme.fg("text", `${totalLabel} / ${windowLabel}`)}  ${this.theme.fg("muted", percentLabel)}  ${this.theme.fg("dim", "provider aggregate")}`),
      row(` ${this.theme.fg("dim", `Breakdown estimates use Pi's conservative chars/4 heuristic (subtotal ${formatTokens(this.breakdown.estimated)}).`)}`),
      row(),
    ];

    const visibleItems = view.items.slice(this.scroll, this.scroll + maxRows);
    const denominator = this.breakdown.total && this.breakdown.total > 0 ? this.breakdown.total : this.breakdown.estimated;
    for (const [visibleIndex, item] of visibleItems.entries()) {
      const index = this.scroll + visibleIndex;
      const selected = index === this.selected;
      const marker = selected ? this.theme.fg("accent", "▶") : " ";
      const suffix = item.children?.length ? this.theme.fg("muted", `  ${item.children.length} items ›`) : "";
      const percent = denominator > 0 ? `${((item.tokens / denominator) * 100).toFixed(1)}%` : "";
      const value = `${formatTokens(item.tokens)}  ${percent}`;
      const reserved = visibleWidth(value) + 4;
      const label = truncateToWidth(`${marker} ${item.label}${suffix}`, Math.max(4, innerWidth - reserved), "…");
      const padding = " ".repeat(Math.max(1, innerWidth - visibleWidth(label) - visibleWidth(value) - 2));
      lines.push(row(` ${label}${padding}${this.theme.fg(item.tokens < 0 ? "warning" : "text", value)} `, selected));
    }

    if (view.items.length === 0) lines.push(row(` ${this.theme.fg("dim", "No items currently retained in context.")}`));
    if (view.items.length > maxRows) {
      lines.push(row(` ${this.theme.fg("dim", `${this.scroll + 1}–${Math.min(this.scroll + maxRows, view.items.length)} of ${view.items.length}`)}`));
    }

    const selectedItem = view.items[this.selected];
    lines.push(row());
    if (selectedItem?.detail) lines.push(row(` ${this.theme.fg("muted", selectedItem.detail)}`));
    lines.push(row(` ${this.theme.fg("dim", "↑↓ navigate • Enter drill down • ←/Backspace back • Esc close")}`));
    lines.push(border("╰", "─", "╯"));
    return lines;
  }

  invalidate(): void {}
}

export default function contextMonitor(pi: ExtensionAPI) {
  pi.registerCommand("ctx-monitor", {
    description: "Inspect current context usage by source and file",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("The context monitor requires TUI mode.", "warning");
        return;
      }

      // Fails fast rather than queueing: a command that silently waits for an
      // open prompt looks like a hang.
      if (isUiBusy()) {
        ctx.ui.notify("Another prompt is open. Answer it before opening the context monitor.", "warning");
        return;
      }

      const breakdown = buildBreakdown(ctx);
      await withUiLock(() =>
        ctx.ui.custom<void>(
          (tui, theme, _keybindings, done) => {
            const component = new ContextMonitorComponent(theme, breakdown, done);
            return {
              render: (width) => component.render(width),
              invalidate: () => component.invalidate(),
              handleInput: (data) => {
                component.handleInput(data);
                tui.requestRender();
              },
            };
          },
          {
            overlay: true,
            overlayOptions: {
              width: "72%",
              minWidth: 68,
              maxHeight: "85%",
              anchor: "center",
              margin: 1,
            },
          },
        ),
      );
    },
  });
}
