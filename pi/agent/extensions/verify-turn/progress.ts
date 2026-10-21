import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type ProgressContext = Pick<ExtensionContext, "mode" | "hasUI"> & {
  ui: Pick<ExtensionContext["ui"], "notify">;
};

/**
 * Reports verifier progress to non-terminal UI clients, such as Paseo over RPC. Those clients
 * do not render the TUI project-checks panel and ignore `setStatus`, but show notifications.
 */
export function notifyOutsideTui(ctx: ProgressContext, message: string): void {
  if (ctx.mode === "tui" || !ctx.hasUI) return;
  ctx.ui.notify(message, "info");
}
