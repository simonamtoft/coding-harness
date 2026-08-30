import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const BANNER = [
  "▄▀█ █▀▄▀█ ▀█▀ █▀█ █▀▀ ▀█▀     █▀▄ █▀▀ █ █",
  "█▀█ █ ▀ █  █  █▄█ █▀   █   .  █▄▀ ██▄ ▀▄▀",
];

function buildHeader(theme: Theme, width: number): string[] {
  const art = BANNER.map((line) => theme.bold(theme.fg("accent", line)));
  return ["", ...art, ""].map((line) => truncateToWidth(line, width, ""));
}

export default function customHeader(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        return buildHeader(theme, width);
      },
      invalidate() {},
    }));
  });

  pi.registerCommand("builtin-header", {
    description: "Restore Pi's built-in startup header",
    handler: async (_args, ctx) => {
      ctx.ui.setHeader(undefined);
      ctx.ui.notify("Built-in header restored", "info");
    },
  });
}
