import { describe, expect, mock, test } from "bun:test";

mock.module("@earendil-works/pi-tui", () => ({
  truncateToWidth: (text: string, width: number) => Array.from(text).slice(0, width).join(""),
  visibleWidth: (text: string) => Array.from(text).length,
}));

const { visibleWidth } = await import("@earendil-works/pi-tui");
const { default: customHeader } = await import("./index.ts");

type SessionStart = (event: unknown, context: any) => void;
type Command = { handler: (args: string, context: any) => Promise<void> };
type HeaderFactory = (tui: unknown, theme: typeof theme) => { render: (width: number) => string[] };

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
};

function loadExtension() {
  let sessionStart: SessionStart | undefined;
  let command: Command | undefined;

  customHeader({
    on(event: string, handler: SessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
    registerCommand(name: string, definition: Command) {
      if (name === "builtin-header") command = definition;
    },
  } as never);

  return { sessionStart, command };
}

describe("custom header", () => {
  test("replaces the TUI header with compact Amtoft.dev art", () => {
    const { sessionStart } = loadExtension();
    let headerFactory: HeaderFactory | undefined;

    sessionStart?.({}, {
      mode: "tui",
      ui: { setHeader: (factory: HeaderFactory) => { headerFactory = factory; } },
    });

    const lines = headerFactory?.({}, theme).render(80) ?? [];
    expect(lines.join("\n")).toContain("▄▀█ █▀▄▀█");
    expect(lines.join("\n")).toContain("█   .  █▄▀");
    expect(lines.join("\n")).not.toContain("Amtoft.dev · Pi");
  });

  test("keeps every rendered line within narrow terminal widths", () => {
    const { sessionStart } = loadExtension();
    let headerFactory: HeaderFactory | undefined;

    sessionStart?.({}, {
      mode: "tui",
      ui: { setHeader: (factory: HeaderFactory) => { headerFactory = factory; } },
    });

    const lines = headerFactory?.({}, theme).render(20) ?? [];
    expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
  });

  test("does not install a terminal header outside TUI mode", () => {
    const { sessionStart } = loadExtension();
    let calls = 0;

    sessionStart?.({}, {
      mode: "rpc",
      ui: { setHeader: () => { calls += 1; } },
    });

    expect(calls).toBe(0);
  });

  test("restores the built-in header on command", async () => {
    const { command } = loadExtension();
    let header: unknown = "custom";
    let notification = "";

    await command?.handler("", {
      ui: {
        setHeader: (value: unknown) => { header = value; },
        notify: (message: string) => { notification = message; },
      },
    });

    expect(header).toBeUndefined();
    expect(notification).toBe("Built-in header restored");
  });
});
